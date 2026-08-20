import { parseFrontmatter, SPEC_BY_PATH } from "@/lib/tome/schema";
import { stripAgentHtmlComments } from "@/lib/tome/wiki-export";

export const PRESENTATION_SOURCE_SCOPES = ["current", "selected", "wiki"] as const;
export type PresentationSourceScope = (typeof PRESENTATION_SOURCE_SCOPES)[number];

export const PRESENTATION_TONES = ["executive", "conversational", "formal", "persuasive"] as const;
export type PresentationTone = (typeof PRESENTATION_TONES)[number];

export const PRESENTATION_DETAIL_LEVELS = ["low", "balanced", "high"] as const;
export type PresentationDetailLevel = (typeof PRESENTATION_DETAIL_LEVELS)[number];

export const PRESENTATION_VISUAL_MODES = ["diagrams", "graphics", "both", "none"] as const;
export type PresentationVisualMode = (typeof PRESENTATION_VISUAL_MODES)[number];

export const PRESENTATION_VISUAL_KINDS = ["diagram", "graphic"] as const;
export type PresentationVisualKind = (typeof PRESENTATION_VISUAL_KINDS)[number];

export const PRESENTATION_VISUAL_LAYOUTS = ["flow", "layers", "grid", "timeline"] as const;
export type PresentationVisualLayout = (typeof PRESENTATION_VISUAL_LAYOUTS)[number];

export interface PresentationVisualGroup {
  label: string;
  items: string[];
}

export interface PresentationRequirements {
  goal: string;
  keyMessage: string;
  audience: string;
  slideCount: number;
  durationMinutes: number | null;
  tone: PresentationTone;
  technicalDetail: PresentationDetailLevel;
  requiredSections: string;
  excludedTopics: string;
  visualMode: PresentationVisualMode;
  visualPreferences: string;
  includeSpeakerNotes: boolean;
}

export interface PresentationSource {
  path: string;
  title: string;
  content: string;
}

export interface PresentationBullet {
  text: string;
  source_refs: string[];
  generated: boolean;
}

export interface PresentationVisual {
  kind: PresentationVisualKind;
  description: string;
  title: string;
  layout: PresentationVisualLayout;
  groups: PresentationVisualGroup[];
  connections: string[];
  source_refs: string[];
}

export interface PresentationSlide {
  id: string;
  title: string;
  subtitle: string;
  bullets: PresentationBullet[];
  visual: PresentationVisual | null;
  speaker_notes: string;
}

export interface PresentationDeck {
  title: string;
  subtitle: string;
  slides: PresentationSlide[];
}

export const DEFAULT_PRESENTATION_REQUIREMENTS: PresentationRequirements = {
  goal: "Align stakeholders on the current state, key decisions, and next steps.",
  keyMessage: "The selected sources provide an evidence-backed path from current state to action.",
  audience: "Project stakeholders and decision-makers",
  slideCount: 8,
  durationMinutes: 15,
  tone: "executive",
  technicalDetail: "balanced",
  requiredSections: "Context, current state, key findings, risks, recommendations, and next steps",
  excludedTopics: "Unverified claims, unsupported projections, and hidden agent-only material",
  visualMode: "both",
  visualPreferences: "Clean, accessible layouts with diagrams and purposeful graphics where useful",
  includeSpeakerNotes: true,
};

export function defaultPresentationRequirements(subject?: string): PresentationRequirements {
  const label = subject?.trim();
  if (!label) return { ...DEFAULT_PRESENTATION_REQUIREMENTS };
  return {
    ...DEFAULT_PRESENTATION_REQUIREMENTS,
    goal: `Brief stakeholders on ${label} and align them on key decisions and next steps.`,
    keyMessage: `${label} has a clear, evidence-backed story and actionable next steps.`,
  };
}

/** Normalize untrusted AI Assist output while preserving usable current values. */
export function normalizePresentationRequirements(
  value: unknown,
  fallback: PresentationRequirements = DEFAULT_PRESENTATION_REQUIREMENTS,
): PresentationRequirements {
  const root = objectValue(value, "requirements");
  const field = (snakeCase: string, camelCase?: string): unknown => (
    root[snakeCase] ?? (camelCase ? root[camelCase] : undefined)
  );
  const stringOrFallback = (
    snakeCase: string,
    camelCase: string,
    current: string,
    maxLength: number,
  ): string => {
    const candidate = optionalString(field(snakeCase, camelCase), maxLength);
    return candidate || current;
  };
  const numberInRange = (
    snakeCase: string,
    camelCase: string,
    current: number | null,
    min: number,
    max: number,
  ): number | null => {
    const candidate = field(snakeCase, camelCase);
    if (candidate === null && snakeCase === "duration_minutes") return null;
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) return current;
    return Math.max(min, Math.min(max, Math.round(candidate)));
  };
  const tone = typeof root.tone === "string" && (PRESENTATION_TONES as readonly string[]).includes(root.tone)
    ? root.tone as PresentationTone
    : fallback.tone;
  const rawTechnicalDetail = field("technical_detail", "technicalDetail");
  const technicalDetail = typeof rawTechnicalDetail === "string"
    && (PRESENTATION_DETAIL_LEVELS as readonly string[]).includes(rawTechnicalDetail)
    ? rawTechnicalDetail as PresentationDetailLevel
    : fallback.technicalDetail;
  const rawVisualMode = field("visual_mode", "visualMode");
  const visualMode = typeof rawVisualMode === "string"
    && (PRESENTATION_VISUAL_MODES as readonly string[]).includes(rawVisualMode)
    ? rawVisualMode as PresentationVisualMode
    : fallback.visualMode;
  return {
    goal: stringOrFallback("goal", "goal", fallback.goal, 2_000),
    keyMessage: stringOrFallback("key_message", "keyMessage", fallback.keyMessage, 1_000),
    audience: stringOrFallback("audience", "audience", fallback.audience, 1_000),
    slideCount: numberInRange("slide_count", "slideCount", fallback.slideCount, 3, 30) ?? fallback.slideCount,
    durationMinutes: numberInRange("duration_minutes", "durationMinutes", fallback.durationMinutes, 1, 180),
    tone,
    technicalDetail,
    requiredSections: stringOrFallback("required_sections", "requiredSections", fallback.requiredSections, 3_000),
    excludedTopics: stringOrFallback("excluded_topics", "excludedTopics", fallback.excludedTopics, 3_000),
    visualMode,
    visualPreferences: stringOrFallback("visual_preferences", "visualPreferences", fallback.visualPreferences, 2_000),
    includeSpeakerNotes: typeof field("include_speaker_notes", "includeSpeakerNotes") === "boolean"
      ? field("include_speaker_notes", "includeSpeakerNotes") as boolean
      : fallback.includeSpeakerNotes,
  };
}

function requiredLine(label: string, value: string): string {
  return `- ${label}: ${value.trim() || "Not specified"}`;
}

/** Compose the user-reviewable instruction. Source bodies are attached server-side. */
export function buildPresentationPrompt(
  requirements: PresentationRequirements,
  sourceManifest: Array<Pick<PresentationSource, "path" | "title">>,
): string {
  const sourceLines = sourceManifest.map((source) => `- ${source.title} (${source.path})`);
  return [
    "Create an editable presentation grounded in the attached TOME wiki pages.",
    "",
    "Presentation requirements:",
    requiredLine("Goal", requirements.goal),
    requiredLine("Key message", requirements.keyMessage),
    requiredLine("Audience", requirements.audience),
    `- Length: ${requirements.slideCount} slides${requirements.durationMinutes ? ` for about ${requirements.durationMinutes} minutes` : ""}`,
    `- Tone: ${requirements.tone}`,
    `- Technical detail: ${requirements.technicalDetail}`,
    requiredLine("Required sections or topics", requirements.requiredSections),
    requiredLine("Topics to exclude", requirements.excludedTopics),
    `- Visual content: ${requirements.visualMode}`,
    requiredLine("Visual and branding preferences", requirements.visualPreferences),
    `- Speaker notes: ${requirements.includeSpeakerNotes ? "include" : "omit"}`,
    "",
    "Selected wiki sources:",
    ...(sourceLines.length > 0 ? sourceLines : ["- No sources selected"]),
    "",
    "Use concise slide copy. Cite source page paths on every source-backed bullet. Mark synthesis, recommendations, and other unsupported additions as generated. Do not invent facts.",
  ].join("\n");
}

export function presentationSourceFromPage(path: string, markdown: string): PresentationSource {
  const [frontmatter, body] = parseFrontmatter(markdown);
  const title = typeof frontmatter.title === "string" && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : (SPEC_BY_PATH.get(path)?.title ?? path);
  return { path, title, content: stripAgentHtmlComments(body) };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim().slice(0, maxLength);
}

function optionalString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function sourceRefs(value: unknown, allowedPaths: Set<string>, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of source page paths`);
  }
  const refs = [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
  const invalid = refs.find((entry) => !allowedPaths.has(entry));
  if (invalid) throw new Error(`${label} references an unselected page: ${invalid}`);
  return refs;
}

/** Validate and normalize untrusted model/client JSON before preview or export. */
export function normalizePresentationDeck(
  value: unknown,
  allowedSourcePaths: Iterable<string>,
): PresentationDeck {
  const root = objectValue(value, "deck");
  const rawSlides = root.slides;
  if (!Array.isArray(rawSlides) || rawSlides.length === 0 || rawSlides.length > 40) {
    throw new Error("deck.slides must contain between 1 and 40 slides");
  }
  const allowedPaths = new Set(allowedSourcePaths);
  const usedIds = new Set<string>();
  const slides = rawSlides.map((rawSlide, slideIndex): PresentationSlide => {
    const slide = objectValue(rawSlide, `slide ${slideIndex + 1}`);
    const rawBullets = slide.bullets;
    if (!Array.isArray(rawBullets) || rawBullets.length > 12) {
      throw new Error(`slide ${slideIndex + 1}.bullets must be an array with at most 12 items`);
    }
    const bullets = rawBullets.map((rawBullet, bulletIndex): PresentationBullet => {
      const bullet = typeof rawBullet === "string"
        ? { text: rawBullet, source_refs: [], generated: true }
        : objectValue(rawBullet, `slide ${slideIndex + 1} bullet ${bulletIndex + 1}`);
      const refs = sourceRefs(
        bullet.source_refs,
        allowedPaths,
        `slide ${slideIndex + 1} bullet ${bulletIndex + 1}.source_refs`,
      );
      return {
        text: requiredString(bullet.text, `slide ${slideIndex + 1} bullet ${bulletIndex + 1}.text`, 800),
        source_refs: refs,
        generated: refs.length === 0 || bullet.generated === true,
      };
    });

    let visual: PresentationVisual | null = null;
    if (slide.visual) {
      const rawVisual = objectValue(slide.visual, `slide ${slideIndex + 1}.visual`);
      const description = optionalString(rawVisual.description, 800);
      if (description) {
        const rawGroups = Array.isArray(rawVisual.groups) ? rawVisual.groups.slice(0, 8) : [];
        const groups = rawGroups.flatMap((rawGroup, groupIndex): PresentationVisualGroup[] => {
          if (!rawGroup || typeof rawGroup !== "object" || Array.isArray(rawGroup)) return [];
          const group = rawGroup as Record<string, unknown>;
          const label = optionalString(group.label, 80);
          const items = Array.isArray(group.items)
            ? group.items.flatMap((item) => {
              const normalized = optionalString(item, 100);
              return normalized ? [normalized] : [];
            }).slice(0, 8)
            : [];
          return label || items.length > 0
            ? [{ label: label || `Group ${groupIndex + 1}`, items }]
            : [];
        });
        const connections = Array.isArray(rawVisual.connections)
          ? rawVisual.connections.flatMap((connection) => {
            const normalized = optionalString(connection, 160);
            return normalized ? [normalized] : [];
          }).slice(0, 12)
          : [];
        visual = {
          kind: typeof rawVisual.kind === "string"
            && (PRESENTATION_VISUAL_KINDS as readonly string[]).includes(rawVisual.kind)
            ? rawVisual.kind as PresentationVisualKind
            : "diagram",
          description,
          title: optionalString(rawVisual.title, 120),
          layout: typeof rawVisual.layout === "string"
            && (PRESENTATION_VISUAL_LAYOUTS as readonly string[]).includes(rawVisual.layout)
            ? rawVisual.layout as PresentationVisualLayout
            : "flow",
          groups,
          connections,
          source_refs: sourceRefs(
            rawVisual.source_refs,
            allowedPaths,
            `slide ${slideIndex + 1}.visual.source_refs`,
          ),
        };
      }
    }

    const candidateId = optionalString(slide.id, 80) || `slide-${slideIndex + 1}`;
    const id = usedIds.has(candidateId) ? `${candidateId}-${slideIndex + 1}` : candidateId;
    usedIds.add(id);
    return {
      id,
      title: requiredString(slide.title, `slide ${slideIndex + 1}.title`, 200),
      subtitle: optionalString(slide.subtitle, 300),
      bullets,
      visual,
      speaker_notes: optionalString(slide.speaker_notes, 5_000),
    };
  });
  return {
    title: requiredString(root.title, "deck.title", 240),
    subtitle: optionalString(root.subtitle, 400),
    slides,
  };
}

export function presentationSourceRefs(slide: PresentationSlide): string[] {
  return [...new Set([
    ...slide.bullets.flatMap((bullet) => bullet.source_refs),
    ...(slide.visual?.source_refs ?? []),
  ])];
}

/** Build a canonical, safely encoded URL for a page included in an exported presentation. */
export function presentationSourceUrl(sourceBaseUrl: string, path: string): string {
  const baseUrl = sourceBaseUrl.endsWith("/") ? sourceBaseUrl : `${sourceBaseUrl}/`;
  const encodedPath = path
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(encodedPath, baseUrl).toString();
}
