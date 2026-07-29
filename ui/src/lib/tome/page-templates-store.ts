/**
 * Page-template config store.
 *
 * Templates (which pages a project / connected source gets seeded, their
 * kind/order/title/grounding) were hardcoded in three places: this app's
 * `schema.ts`, the agent's `reports/schema.py`, and each Python connector.
 * This module makes them a single DB-backed config that the UI and the agent
 * both read, so a TOME Admin can edit them without a redeploy.
 *
 * Seed semantics are the INVERSE of seed-config.ts: we insert defaults only
 * when a scope is absent. Once seeded, Mongo is the source of truth — restarts
 * never clobber admin edits. `schema.ts` (and the Python constants) remain the
 * fallback used only when the DB read fails.
 *
 * Server-only.
 */

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { PAGE_KINDS, type PageKind } from "@/types/tome";
import {
  DEFAULT_PAGES,
  REPO_TEMPLATE,
  CONFLUENCE_TEMPLATE,
  WEBEX_TEMPLATE,
  STABLE_SEED_BODIES,
  MEMORY_SEED,
  pageWithFrontmatter,
  type PageSpec,
} from "@/lib/tome/schema";

export const PAGE_TEMPLATES_COLLECTION = "tome_page_templates";

export const TEMPLATE_SCOPES = ["top-level", "github", "confluence", "webex"] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

export interface StoredPageSpec {
  path: string;
  kind: PageKind;
  title: string;
  order: number;
  /**
   * Seed-body markdown: the founding content a fresh project's page starts
   * with. Every page kind may carry one; stable/hidden ship with default
   * scaffolds, dynamic/report default to empty until an admin sets one.
   */
  body?: string;
  /**
   * When false, templating for this page is off: it's excluded from seeding
   * and the ingest prompt. Absent/true = enabled.
   */
  enabled?: boolean;
}

export interface PageTemplateDoc {
  _id: TemplateScope;
  scope: TemplateScope;
  pages: StoredPageSpec[];
  version: number;
  updated_at: string;
  updated_by: string | null;
}

/** Hardcoded fallback per scope — the seed source and the read fallback. */
const FALLBACK_TEMPLATES: Record<TemplateScope, readonly PageSpec[]> = {
  "top-level": DEFAULT_PAGES,
  github: REPO_TEMPLATE,
  confluence: CONFLUENCE_TEMPLATE,
  webex: WEBEX_TEMPLATE,
};

/**
 * Founding structure guidance for agent-written (dynamic/report) pages, keyed
 * by scope then path. It seeds into the page's default body as an HTML comment
 * (invisible when rendered, visible to the ingest agent and in the editor), so
 * "what this page should contain" lives in the one place an admin edits — the
 * seed body — instead of a separate field. Migrated from prompts/INGEST.md.
 */
const DEFAULT_GUIDANCE: Record<TemplateScope, Record<string, string>> = {
  "top-level": {
    "standup.md":
      "Report card — keep this EXACT Markdown structure; it is parsed by the UI. Under ~200 words.\n" +
      "Put every heading on its own line with a blank line after it. Do not use bold labels as headings.\n" +
      "## What is this\nOne or two plain sentences.\n\n" +
      "## Headline\nOne concise sentence: the single most important thing this period.\n\n" +
      "## Asks / Blockers\n- One blocker or ask per real Markdown bullet; cite when useful.\n\n" +
      "## Up next\n- One milestone or deadline per real Markdown bullet.",
    "activity.md":
      "The significant recent work across ALL attached sources, interpreted and " +
      "organized by theme/goal — not a feed. Cite the few items that matter.",
    "architecture.md":
      "The technical landscape across the effort: major components, key patterns, " +
      "recent ADR signals and risk flags. Cite sources.",
  },
  github: {
    "overview.md": "Repo summary, ownership, health. What this repo is and its role in the effort.",
    "activity.md":
      "Commits, PRs, and releases read against the roadmap — what recent work adds up " +
      "to, by theme. Not a feed; cite the few items that matter.",
    "architecture.md": "Patterns, ADRs, and tech decisions in this repo. Cite files/PRs.",
    "status.md":
      "Where this repo IS right now: open issues, blockers, velocity. A few short " +
      "paragraphs a teammate would say. If little changed, say so in a sentence.",
    "conversations.md": "Issue and PR discussion themes — what's being debated, citing threads.",
  },
  webex: {
    "overview.md": "Room context, participants, purpose. What this room is for.",
    "actions.md":
      "Action items surfaced from the room: what, owner, and age. Cite the messages.",
    "activity.md":
      "An interpreted read of recent discussion (themes, decisions, open questions), " +
      "citing the few messages that matter. NOT a dated message list. If quiet, one sentence.",
  },
  confluence: {
    "overview.md": "Space purpose and key docs. What this space is for and its authoritative pages.",
    "activity.md":
      "Recent significant page changes, interpreted by theme — what moved and why it " +
      "matters. Not a change log.",
    "references.md":
      "The authoritative docs in this space and their staleness — what to trust, and " +
      "what looks out of date.",
  },
};

/** Wrap guidance text as an HTML comment for embedding in a seed body. */
function guidanceComment(guidance: string): string {
  return `<!--\nGuidance for the ingest agent (not rendered; edit or delete freely):\n\n${guidance}\n-->\n`;
}

/** Default seed body for a page, or undefined if it seeds empty. */
function defaultBody(spec: PageSpec, scope: TemplateScope): string | undefined {
  if (spec.kind === "stable") return STABLE_SEED_BODIES[spec.path];
  if (spec.kind === "hidden") return MEMORY_SEED;
  const guidance = DEFAULT_GUIDANCE[scope]?.[spec.path];
  return guidance ? guidanceComment(guidance) : undefined;
}

function toStored(spec: PageSpec, scope: TemplateScope): StoredPageSpec {
  const body = defaultBody(spec, scope);
  return {
    path: spec.path,
    kind: spec.kind,
    title: spec.title,
    order: spec.order,
    enabled: true,
    ...(body !== undefined ? { body } : {}),
  };
}

function fallbackDoc(scope: TemplateScope): PageTemplateDoc {
  return {
    _id: scope,
    scope,
    pages: FALLBACK_TEMPLATES[scope].map((s) => toStored(s, scope)),
    version: 0,
    updated_at: new Date(0).toISOString(),
    updated_by: null,
  };
}

/**
 * Seed each scope's defaults. Idempotent and replica-safe.
 *
 * A version-0 doc means "still the shipped defaults, never admin-edited"; we
 * keep those synced to the current code defaults so schema changes (new pages,
 * added seed bodies) propagate to un-edited installs on upgrade. The first
 * admin edit bumps the version to ≥1, after which this never touches the doc —
 * so admin edits always survive restarts.
 */
export async function seedPageTemplates(): Promise<void> {
  if (!isMongoDBConfigured) return;
  const col = await getCollection<PageTemplateDoc>(PAGE_TEMPLATES_COLLECTION);
  for (const scope of TEMPLATE_SCOPES) {
    const existing = await col.findOne({ _id: scope });
    if (existing && (existing.version ?? 0) >= 1) continue; // admin-edited — leave it
    try {
      // Insert when absent; refresh in place when still at version 0.
      await col.replaceOne({ _id: scope }, fallbackDoc(scope), { upsert: true });
    } catch {
      // Duplicate-key from a concurrent replica seeding the same scope — fine.
    }
  }
}

/** Read one scope's template. Falls back to the hardcoded default on any error. */
export async function getPageTemplate(scope: TemplateScope): Promise<PageTemplateDoc> {
  if (!isMongoDBConfigured) return fallbackDoc(scope);
  try {
    const col = await getCollection<PageTemplateDoc>(PAGE_TEMPLATES_COLLECTION);
    const doc = await col.findOne({ _id: scope });
    return doc ?? fallbackDoc(scope);
  } catch {
    return fallbackDoc(scope);
  }
}

/** Read all scopes. Missing scopes fall back to their hardcoded default. */
export async function getAllPageTemplates(): Promise<PageTemplateDoc[]> {
  return Promise.all(TEMPLATE_SCOPES.map(getPageTemplate));
}

/**
 * `{path: founding markdown}` for the top-level template's stable pages, built
 * from the live config. Config-driven replacement for schema.ts
 * `stableSeedTemplates()`; used by the ingest runner to seed founding stable
 * pages.
 */
export async function getStableSeedTemplates(): Promise<Record<string, string>> {
  const template = await getPageTemplate("top-level");
  const out: Record<string, string> = {};
  for (const spec of template.pages) {
    if (spec.enabled === false) continue;
    if (spec.kind === "stable" && spec.body !== undefined) {
      out[spec.path] = pageWithFrontmatter(spec, spec.body);
    }
  }
  return out;
}

export interface TemplateValidationError {
  field: string;
  message: string;
}

/**
 * Validate a proposed page list for a scope. Guards against edits that would
 * break ingest: unique non-empty paths, valid kinds, and (top-level only) the
 * required stable-page invariants that dynamic pages ground against.
 */
export function validateTemplatePages(
  scope: TemplateScope,
  pages: StoredPageSpec[],
): TemplateValidationError[] {
  const errors: TemplateValidationError[] = [];

  if (!Array.isArray(pages) || pages.length === 0) {
    errors.push({ field: "pages", message: "A template must have at least one page." });
    return errors;
  }

  const seen = new Set<string>();
  for (const [i, p] of pages.entries()) {
    if (!p.path || !p.path.trim()) {
      errors.push({ field: `pages[${i}].path`, message: "Path is required." });
    } else if (seen.has(p.path)) {
      errors.push({ field: `pages[${i}].path`, message: `Duplicate path "${p.path}".` });
    } else {
      seen.add(p.path);
    }
    if (!p.title || !p.title.trim()) {
      errors.push({ field: `pages[${i}].title`, message: "Title is required." });
    }
    if (!(PAGE_KINDS as readonly string[]).includes(p.kind)) {
      errors.push({ field: `pages[${i}].kind`, message: `Invalid kind "${p.kind}".` });
    }
    if (typeof p.order !== "number" || Number.isNaN(p.order)) {
      errors.push({ field: `pages[${i}].order`, message: "Order must be a number." });
    }
  }

  return errors;
}

/**
 * Replace a scope's page list. Returns the updated doc, or throws
 * TemplateValidationFailure with the validation errors.
 */
export class TemplateValidationFailure extends Error {
  constructor(public readonly errors: TemplateValidationError[]) {
    super("Page template validation failed");
    this.name = "TemplateValidationFailure";
  }
}

export async function updatePageTemplate(
  scope: TemplateScope,
  pages: StoredPageSpec[],
  updatedBy: string | null,
): Promise<PageTemplateDoc> {
  const errors = validateTemplatePages(scope, pages);
  if (errors.length > 0) throw new TemplateValidationFailure(errors);

  const col = await getCollection<PageTemplateDoc>(PAGE_TEMPLATES_COLLECTION);
  const current = await col.findOne({ _id: scope });
  const nextVersion = (current?.version ?? 0) + 1;

  const normalized: StoredPageSpec[] = pages.map((p) => ({
    path: p.path.trim(),
    kind: p.kind,
    title: p.title.trim(),
    order: p.order,
    enabled: p.enabled !== false,
    // Every kind may carry a seed body; keep it when present.
    ...(typeof p.body === "string" ? { body: p.body } : {}),
  }));

  const doc: PageTemplateDoc = {
    _id: scope,
    scope,
    pages: normalized,
    version: nextVersion,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  };

  await col.replaceOne({ _id: scope }, doc, { upsert: true });
  return doc;
}

/** Overwrite a scope's template with the shipped defaults. */
export async function resetPageTemplate(
  scope: TemplateScope,
  updatedBy: string | null,
): Promise<PageTemplateDoc> {
  const defaults = FALLBACK_TEMPLATES[scope].map((s) => toStored(s, scope));
  return updatePageTemplate(scope, defaults, updatedBy);
}
