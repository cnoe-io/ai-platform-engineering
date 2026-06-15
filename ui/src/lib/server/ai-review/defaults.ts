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
    weight: 15,
    micro_prompt:
      "Does the prompt define the agent's role in 1–2 clear sentences stating what it is and what it does? Pass if a reader could accurately summarize the agent's purpose after reading the first paragraph.",
    expects_fix: true,
  },
  {
    id: "sufficiently-scoped",
    name: "Sufficiently scoped",
    severity: "error",
    weight: 15,
    micro_prompt:
      "Is the prompt scoped to a specific domain, system, or task family rather than general-purpose assistance? Pass if the prompt names a concrete domain (e.g. 'infrastructure change reviews', 'Jira ticket triage') that meaningfully constrains what the agent handles.",
    expects_fix: true,
  },
  {
    id: "negative-constraints",
    name: "Defines what agent must NOT do",
    severity: "error",
    weight: 15,
    micro_prompt:
      "Does the prompt explicitly state what the agent must NOT do — actions to refuse, topics to avoid, or boundaries it must not cross? Pass if at least one clear prohibition or refusal condition is defined.",
    expects_fix: true,
  },
  {
    id: "tool-action-constraints",
    name: "Mentions tool / action constraints",
    severity: "warning",
    weight: 10,
    micro_prompt:
      "Does the prompt specify which tools the agent may or may not use, and include guidance on how or when to use them (edge cases, input format, usage conditions)? Pass if tool boundaries and at least basic usage guidance are present. If the agent has no tools, pass if this is explicitly acknowledged.",
    expects_fix: true,
  },
  {
    id: "output-format",
    name: "Specifies output format",
    severity: "warning",
    weight: 10,
    micro_prompt:
      "Does the prompt specify how the agent should format its responses — structure (markdown, JSON, plain text), length, or verbosity? Pass if any output format guidance is present.",
    expects_fix: true,
  },
  {
    id: "failure-mode-handling",
    name: "Handles failure modes",
    severity: "warning",
    weight: 10,
    micro_prompt:
      "Does the prompt define what the agent should do when inputs are malformed, required information is missing, or a tool or step fails mid-task? Pass if at least one error or ambiguity scenario is addressed.",
    expects_fix: true,
  },
  {
    id: "escalation-handoff",
    name: "Defines escalation / handoff",
    severity: "warning",
    weight: 10,
    micro_prompt:
      "Does the prompt define what the agent should do when it cannot complete a request — escalate to a human, hand off to another agent, or refuse with a clear message? Pass if out-of-scope or failure-to-complete behavior is described.",
    expects_fix: true,
  },
  {
    id: "prompt-injection-resistance",
    name: "Guards against prompt injection",
    severity: "warning",
    weight: 8,
    micro_prompt:
      "Does the prompt include language that guards against user-supplied instructions overriding the system guidelines? Pass if there is explicit guidance that external input (user messages, tool outputs, retrieved content) cannot supersede the agent's core rules.",
    expects_fix: true,
  },
  {
    id: "behavior-rules-present",
    name: "Has explicit behavior rules",
    severity: "warning",
    weight: 5,
    micro_prompt:
      "Does the prompt include explicit behavioral guidelines beyond the role statement — rules that constrain how the agent acts, not just what it does? Pass if at least two distinct behavioral rules are present.",
    expects_fix: true,
  },
  {
    id: "conditional-constraints",
    name: "Avoids unconditional absolutes",
    severity: "info",
    weight: 4,
    micro_prompt:
      "Do the agent's behavioral rules use conditional or qualified language ('if X, then Y') rather than unconditional absolutes without context? Pass if rules are conditional, or if any absolute ('always', 'never') is paired with a clear rationale or qualifying condition.",
    expects_fix: true,
  },
  {
    id: "specific-not-generic",
    name: "Role is specific, not generic",
    severity: "info",
    weight: 3,
    micro_prompt:
      "Does the opening role statement name a specific system, tool, team, or domain rather than generic 'helpful assistant' language? Pass if the role description would not apply to any other agent without modification.",
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
    weight: 15,
    micro_prompt:
      "Does the document start with a YAML frontmatter block delimited by '---' that contains both a 'name' and a 'description' field? Pass only if both fields are present and non-empty inside the frontmatter.",
    expects_fix: true,
  },
  {
    id: "instructions-section",
    name: "Has Instructions section",
    severity: "error",
    weight: 15,
    micro_prompt:
      "Does the document include a section titled 'Instructions' (case-insensitive H2 or H3)? Pass if such a section exists and contains at least a sentence of content.",
    expects_fix: true,
  },
  {
    id: "description-trigger-condition",
    name: "Description states when to use it",
    severity: "error",
    weight: 15,
    micro_prompt:
      "Does the frontmatter 'description' field include a trigger condition — language telling the user or agent when to invoke this skill (e.g. 'Use when...', 'Use to...', or a clear use-case statement)? Pass if the description conveys not just what the skill does but when it applies.",
    expects_fix: true,
  },
  {
    id: "output-format-section",
    name: "Has Output Format section",
    severity: "warning",
    weight: 10,
    micro_prompt:
      "Does the document describe the expected output format somewhere (an 'Output Format' section, or equivalent guidance under another heading)? Pass if output formatting is described — ideally with a rendered example, not just abstract description.",
    expects_fix: true,
  },
  {
    id: "examples-section",
    name: "Has Examples section with realistic utterances",
    severity: "warning",
    weight: 10,
    micro_prompt:
      "Does the document include an 'Examples' section (case-insensitive H2 or H3) with at least one example that looks like a realistic user message or invocation (not an abstract description)? Pass if such a section exists and examples are phrased as plausible user inputs.",
    expects_fix: true,
  },
  {
    id: "instructions-actionable",
    name: "Instructions are concrete and actionable",
    severity: "warning",
    weight: 10,
    micro_prompt:
      "Are the instructions concrete and step-oriented — numbered steps, phases, or specific actions — rather than vague guidance? Pass if a reader could follow the instructions to complete the task without additional interpretation.",
    expects_fix: true,
  },
  {
    id: "guidelines-mentioned",
    name: "Has Guidelines section",
    severity: "warning",
    weight: 8,
    micro_prompt:
      "Does the document include a 'Guidelines' section (or clearly labeled best-practices block) covering do/don't behavior or constraints on how the skill should behave? Pass if such guidance is present.",
    expects_fix: true,
  },
  {
    id: "scope-bounded",
    name: "Scoped to one task family",
    severity: "warning",
    weight: 7,
    micro_prompt:
      "Is the skill focused on a specific task or task family rather than being a catch-all? Pass if the skill's title, description, and instructions all point to a coherent, bounded purpose rather than covering many unrelated workflows.",
    expects_fix: true,
  },
  {
    id: "h1-matches-name",
    name: "H1 matches frontmatter name",
    severity: "info",
    weight: 5,
    micro_prompt:
      "Is the first markdown heading after the frontmatter an H1 (single '#') and does its text closely match the frontmatter 'name' field (case-insensitive, allowing minor punctuation differences)? Pass if both conditions hold.",
    expects_fix: true,
  },
  {
    id: "kebab-case-skill-name",
    name: "Skill name is kebab-case",
    severity: "info",
    weight: 3,
    micro_prompt:
      "Is the frontmatter 'name' field a single kebab-case slug (lowercase letters, digits, hyphens; no spaces or underscores)? Pass only if the name matches /^[a-z0-9][a-z0-9-]*$/.",
    expects_fix: true,
  },
  {
    id: "description-length",
    name: "Description ≤ 400 chars",
    severity: "info",
    weight: 2,
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
