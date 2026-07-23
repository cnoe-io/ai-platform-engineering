import type { OversightCounts, OversightPerson, OversightResult } from "./oversight-grouping";

/**
 * Presentational view-model for the attention-first teams overview
 * (spec 2026-07-06 redesign). Pure derivation over `OversightResult` — no
 * network. Categorises teams into attention / healthy / quiet buckets and
 * surfaces the org-wide `totals` the grouping helper already computed from the
 * distinct flat task list (this helper does not re-dedup).
 */

export type TeamHealth = "at_risk" | "watch" | "healthy" | "quiet";

export interface TeamCardVM {
  /** Team slug, or `null` for the "No team" bucket. */
  slug: string | null;
  name: string;
  total: number;
  active: number;
  paused: number;
  failed: number;
  people: number;
  /** Soonest `next_run` across the team's enabled tasks, or `null`. */
  nextRunIso: string | null;
  health: TeamHealth;
}

export interface OversightSummary {
  totals: { teams: number; tasks: number; paused: number; failed: number };
  /** Teams needing attention (failed or paused), most-severe first. */
  attention: TeamCardVM[];
  /** Teams with tasks and no issues, sorted by name. */
  healthy: TeamCardVM[];
  /** Teams with zero tasks, sorted by name. */
  quiet: TeamCardVM[];
}

function healthOf(counts: OversightCounts): TeamHealth {
  if (counts.ack_failed > 0) return "at_risk";
  if (counts.paused > 0) return "watch";
  if (counts.total > 0) return "healthy";
  return "quiet";
}

/** Soonest upcoming run across a team's enabled, scheduled tasks. */
function soonestNextRun(members: OversightPerson[]): string | null {
  let bestMs = Number.POSITIVE_INFINITY;
  let bestIso: string | null = null;
  for (const person of members) {
    for (const task of person.tasks) {
      if (task.enabled === false || !task.next_run) continue;
      const ms = new Date(task.next_run).getTime();
      if (!Number.isNaN(ms) && ms < bestMs) {
        bestMs = ms;
        bestIso = task.next_run;
      }
    }
  }
  return bestIso;
}

function toCardVM(
  slug: string | null,
  name: string,
  counts: OversightCounts,
  members: OversightPerson[],
): TeamCardVM {
  return {
    slug,
    name,
    total: counts.total,
    active: counts.total - counts.paused,
    paused: counts.paused,
    failed: counts.ack_failed,
    people: members.length,
    nextRunIso: soonestNextRun(members),
    health: healthOf(counts),
  };
}

const byName = (a: TeamCardVM, b: TeamCardVM) => a.name.localeCompare(b.name);
// Most-severe first: failed count, then paused count, then name.
const bySeverity = (a: TeamCardVM, b: TeamCardVM) =>
  b.failed - a.failed || b.paused - a.paused || byName(a, b);

export function summarizeOversight(data: OversightResult): OversightSummary {
  const cards: TeamCardVM[] = data.teams.map((t) => toCardVM(t.slug, t.name, t.counts, t.members));
  // The no-team bucket is a pseudo-team; include it only when it has tasks.
  if (data.no_team.counts.total > 0) {
    cards.push(toCardVM(null, "No team", data.no_team.counts, data.no_team.members));
  }

  return {
    // Pass through the grouping helper's distinct totals; only `teams` (a count
    // of team groups) is a presentation-level addition.
    totals: {
      teams: data.teams.length,
      tasks: data.totals.total,
      paused: data.totals.paused,
      failed: data.totals.ack_failed,
    },
    attention: cards.filter((c) => c.health === "at_risk" || c.health === "watch").sort(bySeverity),
    healthy: cards.filter((c) => c.health === "healthy").sort(byName),
    quiet: cards.filter((c) => c.health === "quiet").sort(byName),
  };
}
