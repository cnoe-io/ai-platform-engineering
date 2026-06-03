/**
 * Spec-Health scoring — pure, no I/O.
 *
 * Takes an epic artifact's title + body excerpt + labels and produces
 * a 0..100 score plus the list of missing criteria. The score is the
 * weighted sum of six binary signals:
 *
 *   acceptance_criteria      30 pts
 *   non_functional_reqs      15 pts
 *   architectural_constraints 15 pts
 *   test_strategy            15 pts
 *   budget                   10 pts
 *   adr_link                 15 pts
 *
 * The signal extraction is intentionally text-based against the
 * body_excerpt so it works against today's data (no separate spec
 * collection yet). When a real spec store lands the projector swaps
 * to a richer source; the scoring vocabulary stays the same.
 *
 * Bands:
 *   0..49   weak       (red)
 *   50..69  fair       (amber)
 *   70..84  good       (green-ish)
 *   85..100 strong     (emerald)
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import type {
  SpecCriterionStatus,
  SpecHealthEpicScore,
} from "@/types/agentic-sdlc";

export interface SpecScoreInput {
  epic_id: string;
  title: string;
  github_url: string;
  body_excerpt: string | null;
  labels?: string[];
  last_event_at: string;
}

const RULES: Array<{
  kind: SpecCriterionStatus["kind"];
  label: string;
  weight: number;
  matches: (text: string, labels: Set<string>) => boolean;
  hint: string;
}> = [
  {
    kind: "acceptance_criteria",
    label: "Acceptance criteria",
    weight: 30,
    matches: (t) =>
      /acceptance criteria|user stor(?:y|ies)|given.*when.*then/i.test(t),
    hint: "Add a checklist or Given/When/Then block.",
  },
  {
    kind: "non_functional_requirements",
    label: "Non-functional requirements",
    weight: 15,
    matches: (t) =>
      /(latency|throughput|p99|sla|cost budget|memory|nfr|non-?functional)/i.test(t),
    hint: "State the latency / cost / availability targets.",
  },
  {
    kind: "architectural_constraints",
    label: "Architectural constraints",
    weight: 15,
    matches: (t) =>
      /(architecture|constraint|must not|do not use|forbidden|invariant)/i.test(t),
    hint: "Encode what the agent cannot do.",
  },
  {
    kind: "test_strategy",
    label: "Test strategy",
    weight: 15,
    matches: (t, labels) =>
      labels.has("tests") ||
      /(test plan|test strategy|coverage|fuzz|property test|unit test|integration test)/i.test(t),
    hint: "Describe how the change will be verified.",
  },
  {
    kind: "budget",
    label: "Budget",
    weight: 10,
    matches: (t) =>
      /(compute budget|token budget|cost ceiling|hours? budget|spec[- ]complexity)/i.test(t),
    hint: "Give the agent a spend ceiling.",
  },
  {
    kind: "adr_link",
    label: "ADR link",
    weight: 15,
    matches: (t) => /adr[-/]?\d|docs\/adr|architecture decision|RFC[- ]?\d/i.test(t),
    hint: "Link to an ADR or RFC.",
  },
];

export function scoreEpicSpec(input: SpecScoreInput): SpecHealthEpicScore {
  const text = `${input.title}\n\n${input.body_excerpt ?? ""}`;
  const labels = new Set(input.labels ?? []);
  const criteria: SpecCriterionStatus[] = [];
  let score = 0;
  for (const rule of RULES) {
    const present = rule.matches(text, labels);
    if (present) score += rule.weight;
    criteria.push({
      kind: rule.kind,
      label: rule.label,
      present,
      hint: present ? undefined : rule.hint,
    });
  }
  const clamped = Math.max(0, Math.min(100, score));
  const band: SpecHealthEpicScore["band"] =
    clamped >= 85
      ? "strong"
      : clamped >= 70
        ? "good"
        : clamped >= 50
          ? "fair"
          : "weak";
  return {
    epic_id: input.epic_id,
    title: input.title,
    github_url: input.github_url,
    score: clamped,
    band,
    criteria,
    last_event_at: input.last_event_at,
  };
}

export function repoSpecScore(scores: SpecHealthEpicScore[]): number {
  if (scores.length === 0) return 0;
  // Weighted by recency: newer epics dominate the headline score.
  const now = Date.now();
  let weightedSum = 0;
  let weightTotal = 0;
  for (const s of scores) {
    const ageDays = Math.max(
      0,
      (now - Date.parse(s.last_event_at)) / (24 * 60 * 60 * 1000),
    );
    const weight = 1 / (1 + ageDays * 0.05);
    weightedSum += s.score * weight;
    weightTotal += weight;
  }
  return Math.round(weightedSum / weightTotal);
}
