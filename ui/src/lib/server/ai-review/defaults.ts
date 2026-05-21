/**
 * Built-in defaults and registry for AI Review targets.
 *
 * Every target the platform supports lives here as a fixed entry. New
 * surfaces are added by extending `REVIEW_TARGETS` (a code change), not by
 * letting admins coin arbitrary slugs in the UI. This mirrors how AI
 * Suggest's task registry works and keeps the admin tab focused on the
 * two known consumers (the Dynamic Agent system prompt and SKILL.md).
 *
 * `ensureConfig(target)` is the single read path: it returns the persisted
 * doc when one exists, otherwise it inserts the defaults into Mongo and
 * returns that fresh row. There is no "seed vs. doc" split anymore —
 * the collection is just initialized lazily on first read.
 */

import { getCollection } from "@/lib/mongodb";
import {
  DEFAULT_GRADE_THRESHOLDS,
  type ReviewConfig,
  type ReviewCriterion,
} from "@/types/ai-review";

// ---------------------------------------------------------------------------
// agent-system-prompt
// ---------------------------------------------------------------------------

const AGENT_SYSTEM_PROMPT_CRITERIA: ReviewCriterion[] = [
  {
    id: "clear-role-definition",
    name: "Clear role definition",
    severity: "error",
    weight: 2,
    micro_prompt:
      "Does the prompt define the agent's role and personality in 1–3 clear sentences (who it is, what it helps with)? Pass if a reader could state the agent's purpose after reading the first paragraph.",
    expects_fix: true,
  },
  {
    id: "behavior-rules-count",
    name: "Lists 3–7 behavior rules",
    severity: "warning",
    weight: 1,
    micro_prompt:
      "Does the prompt enumerate between 3 and 7 explicit behavior rules or guidelines (bullet list, numbered list, or clearly delimited sentences)? Fewer than 3 is too vague; more than 7 is hard to follow.",
    expects_fix: true,
  },

  {
    id: "tool-action-constraints",
    name: "Mentions tool / action constraints",
    severity: "warning",
    weight: 1,
    micro_prompt:
      "Does the prompt mention which tools or actions the agent may or may not use (or explicitly note 'no tool restrictions apply')? Pass if there is any guidance on tool/action boundaries.",
    expects_fix: true,
  },
  {
    id: "output-format",
    name: "Specifies output format",
    severity: "warning",
    weight: 1,
    micro_prompt:
      "Does the prompt specify how the agent should format its responses (markdown, JSON, plain text, length expectations, etc.)? Pass if any output format guidance is present.",
    expects_fix: true,
  },
  {
    id: "escalation-handoff",
    name: "Defines escalation / handoff",
    severity: "info",
    weight: 1,
    micro_prompt:
      "Does the prompt define what the agent should do when it cannot help — escalate to a human, hand off to another agent, or refuse politely? Pass if escalation/handoff behavior is described.",
    expects_fix: true,
  },
  {
    id: "no-ambiguous-absolutes",
    name: "Avoids ambiguous absolutes",
    severity: "info",
    weight: 1,
    micro_prompt:
      "Does the prompt avoid unconditional 'always' / 'never' statements that lack qualifying conditions? Pass if absolutes are either absent or always paired with a clear condition.",
    expects_fix: true,
  },
  {
    id: "sufficiently-scoped",
    name: "Sufficiently scoped",
    severity: "warning",
    weight: 1,
    micro_prompt:
      "Is the prompt scoped to a specific domain or task family (not so generic that it could describe any assistant)? Pass if the prompt names a domain, system, or task family that constrains its responsibilities.",
    expects_fix: true,
  },
];

// ---------------------------------------------------------------------------
// skill-md
// ---------------------------------------------------------------------------

const SKILL_MD_CRITERIA: ReviewCriterion[] = [
  {
    id: "yaml-frontmatter-present",
    name: "Has YAML frontmatter (name + description)",
    severity: "error",
    weight: 2,
    micro_prompt:
      "Does the document start with a YAML frontmatter block delimited by '---' that contains both a 'name' and a 'description' field? Pass only if both fields are present and non-empty inside the frontmatter.",
    expects_fix: true,
  },
  {
    id: "h1-matches-name",
    name: "H1 matches frontmatter name",
    severity: "warning",
    weight: 1,
    micro_prompt:
      "Is the first markdown heading after the frontmatter an H1 (single '#') and does its text closely match the frontmatter 'name' field (case-insensitive, allowing minor punctuation differences)? Pass if both conditions hold.",
    expects_fix: true,
  },
  {
    id: "instructions-section",
    name: "Has Instructions section",
    severity: "error",
    weight: 1,
    micro_prompt:
      "Does the document include a section titled 'Instructions' (case-insensitive H2 or H3)? Pass if such a section exists and contains at least a sentence of content.",
    expects_fix: true,
  },
  {
    id: "examples-section",
    name: "Has Examples section",
    severity: "warning",
    weight: 1,
    micro_prompt:
      "Does the document include an 'Examples' section (case-insensitive H2 or H3) with at least one example? Pass if such a section exists and is non-empty.",
    expects_fix: true,
  },
  {
    id: "output-format-section",
    name: "Has Output Format section",
    severity: "warning",
    weight: 1,
    micro_prompt:
      "Does the document describe the expected output format somewhere (an 'Output Format' section, or equivalent guidance under another heading)? Pass if output formatting is described.",
    expects_fix: true,
  },
  {
    id: "guidelines-mentioned",
    name: "Mentions Guidelines",
    severity: "info",
    weight: 1,
    micro_prompt:
      "Does the document include a 'Guidelines' section (or clearly labeled best-practices block) covering do/don't behavior? Pass if such guidance is present.",
    expects_fix: true,
  },
  {
    id: "kebab-case-skill-name",
    name: "Skill name is kebab-case",
    severity: "warning",
    weight: 1,
    micro_prompt:
      "Is the frontmatter 'name' field a single kebab-case slug (lowercase letters, digits, hyphens; no spaces or underscores)? Pass only if the name matches /^[a-z0-9][a-z0-9-]*$/.",
    expects_fix: true,
  },
  {
    id: "description-length",
    name: "Description ≤ 400 chars",
    severity: "warning",
    weight: 1,
    micro_prompt:
      "Is the frontmatter 'description' field 400 characters or fewer? Pass if the description exists and its length is within that limit.",
    expects_fix: true,
  },
];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface ReviewTargetMeta {
  /** Stable id; both the `_id` and `target` fields in Mongo. */
  target: string;
  /** Display label for the admin tab. */
  label: string;
  /** Short blurb for the admin tab header. */
  hint: string;
  /** Built-in default criteria. */
  criteria: ReviewCriterion[];
}

/** Fixed list of supported review targets. Adding a target is a code change. */
export const REVIEW_TARGETS: ReviewTargetMeta[] = [
  {
    target: "agent-system-prompt",
    label: "Agent system prompt",
    hint: "Used by the Agent editor's Instructions step.",
    criteria: AGENT_SYSTEM_PROMPT_CRITERIA,
  },
  {
    target: "skill-md",
    label: "Skill SKILL.md",
    hint: "Used by the Skill workspace's Files step.",
    criteria: SKILL_MD_CRITERIA,
  },
];

const REVIEW_TARGET_BY_ID: Record<string, ReviewTargetMeta> = Object.fromEntries(
  REVIEW_TARGETS.map((t) => [t.target, t]),
);

export function getTargetMeta(target: string): ReviewTargetMeta | null {
  return REVIEW_TARGET_BY_ID[target] ?? null;
}

/** Build a fresh defaults document for a known target. Returns null for
 * unknown targets so callers can 404. */
export function buildDefaultConfig(target: string): ReviewConfig | null {
  const meta = REVIEW_TARGET_BY_ID[target];
  if (!meta) return null;
  return {
    _id: meta.target,
    target: meta.target,
    label: meta.label,
    enabled: true,
    enforcement: "informational",
    min_score: 0.85,
    grade_thresholds: { ...DEFAULT_GRADE_THRESHOLDS },
    criteria: meta.criteria.map((c) => ({ ...c })),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Return the persisted config for `target`, inserting the defaults on first
 * read so the collection is self-initializing. Returns null for unknown
 * targets (caller should 404).
 *
 * Both reads and the upsert tolerate Mongo being unavailable: if the
 * collection access throws, we fall back to an in-memory defaults object so
 * the run route still has something to work with.
 */
export async function ensureConfig(
  target: string,
): Promise<ReviewConfig | null> {
  const defaults = buildDefaultConfig(target);
  if (!defaults) return null;
  try {
    const col = await getCollection<ReviewConfig>("review_configs");
    const existing = await col.findOne({ _id: target });
    if (existing) return existing;
    await col.insertOne(defaults);
    return defaults;
  } catch {
    // Mongo unavailable — return an ephemeral defaults object so the
    // consumer flow degrades gracefully. The next call once Mongo is back
    // will persist it.
    return defaults;
  }
}
