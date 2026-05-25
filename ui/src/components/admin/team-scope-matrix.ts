/**
 * Pure pivot for the `team-scope` invariant family.
 *
 * The BFF emits one invariant **per (team_slug, kind)** pair under the
 * `team-scope` group, where `kind` is one of four wiring concerns:
 *
 *   - `active_team_mapper`    — every `team-<slug>` client scope has
 *                               an `active_team` protocol mapper.
 *   - `optional_on_slack_bot` — the scope is bound optional on the
 *                               Slack bot client.
 *   - `optional_on_webex_bot` — the scope is bound optional on the
 *                               Webex bot client.
 *   - `default_on_obo_audience` — the scope is bound default on the
 *                                 `caipe-platform` OBO audience client.
 *                                 NB: `team-personal` deliberately
 *                                 has no audience binding (the
 *                                 structural DM-mode advisory
 *                                 explains why), so this cell is
 *                                 missing for that one slug.
 *
 * At small N (≤ 10 teams) the original flat-list rendering reads
 * fine. At hundreds of teams it becomes 4N parallel rows that all
 * say the same thing — usability cliff. The panel pivots to a
 * `slug × kind` matrix so the team is the row, the wiring concern
 * is the column, and the cell is the status.
 *
 * Everything in this file is **pure** — it takes the panel's raw
 * `KeycloakInvariant[]` and returns a sorted matrix data structure
 * the renderer can lay out without further computation. Any
 * non-`team-scope`-group invariant is silently dropped so callers
 * can safely pass the entire invariant list without pre-filtering.
 *
 * Phase 3 (spec 2026-05-24-derive-team-from-channel) removed the
 * `team_personal.dm_mode_known_limitation` advisory invariant — DMs
 * no longer go through Keycloak token exchange, so there is no
 * RFC 8693 limitation to advertise. The `advisory` field on the
 * returned matrix is retained for back-compat with the renderer but
 * is always `null` now.
 */

import type { KeycloakInvariant, KeycloakInvariantStatus } from "@/lib/rbac/keycloak-invariants";

/**
 * The four wiring concerns we render as matrix columns.
 *
 * Order matters: this is the left-to-right column order. Picked so
 * the most-likely-to-fail concerns sit leftmost — `mapper` (literally
 * the protocol mapper existence) is rarest, then the two bot
 * bindings (most common after a bot client rotation), then audience
 * default last (one final wiring step).
 */
export type TeamScopeKind =
  | "active_team_mapper"
  | "optional_on_slack_bot"
  | "optional_on_webex_bot"
  | "default_on_obo_audience";

export const TEAM_SCOPE_KIND_ORDER: TeamScopeKind[] = [
  "active_team_mapper",
  "optional_on_slack_bot",
  "optional_on_webex_bot",
  "default_on_obo_audience",
];

/**
 * Short labels rendered as matrix column headers. Long labels are
 * still available in the underlying invariants — admins can click
 * into a row to see the full descriptions and machine IDs.
 */
export const TEAM_SCOPE_KIND_LABELS: Record<TeamScopeKind, string> = {
  active_team_mapper: "Mapper",
  optional_on_slack_bot: "Slack bot",
  optional_on_webex_bot: "Webex bot",
  default_on_obo_audience: "Audience",
};

/**
 * One-line description of each column suitable for a column header
 * tooltip. Same wording-style policy as the invariant explainer:
 * technical names survive, plain-English glosses follow.
 */
export const TEAM_SCOPE_KIND_DESCRIPTIONS: Record<TeamScopeKind, string> = {
  active_team_mapper:
    "Each `team-<slug>` client scope must have an `active_team` protocol mapper (a small Keycloak rule that injects an extra claim into the issued token) so the bots' OBO (on-behalf-of) tokens carry a team-identity signal.",
  optional_on_slack_bot:
    "Each `team-<slug>` scope is bound *optional* on the Slack bot client so the bot can request it via `scope=` when impersonating a user in a team channel.",
  optional_on_webex_bot:
    "Each `team-<slug>` scope is bound *optional* on the Webex bot client so the bot can request it via `scope=` when impersonating a user in a Webex space.",
  default_on_obo_audience:
    "Each `team-<slug>` scope (except `team-personal`) must be bound *default* on `caipe-platform` (the shared OBO audience) so Keycloak's RFC 8693 token-exchange flow actually injects the `active_team` claim — that flow drops the requested `scope=` parameter, so only default audience scopes contribute their mappers.",
};

/**
 * A single row in the matrix — one team, the wiring concern → invariant cells,
 * and pre-computed counts so the renderer can sort/colour rows without
 * iterating the cells again.
 */
export interface TeamScopeRow {
  /** The team slug (e.g. `platform`, `eti-sre-admin`, `personal`). */
  slug: string;
  /**
   * `team-personal` is structurally different (no audience binding;
   * DM-mode marker scope). Tagged here so the renderer can label the
   * audience cell N/A and skip it when computing per-row counts.
   */
  isPersonal: boolean;
  /**
   * One entry per kind in `TEAM_SCOPE_KIND_ORDER`. `undefined` means
   * "no invariant emitted for this (slug, kind)" — used for the
   * structural `default_on_obo_audience` skip on `team-personal`.
   */
  cells: Partial<Record<TeamScopeKind, KeycloakInvariant>>;
  /** Count of cells with `status="fail"` for this row. */
  fail_count: number;
  /** Count of cells with `status="unknown"` for this row. */
  unknown_count: number;
  /** Count of cells with `status="pass"` for this row. */
  pass_count: number;
  /** Count of present cells (3 for team-personal, 4 otherwise). */
  total_cells: number;
}

/**
 * Per-kind summary across all teams. Drives the per-kind Fix button
 * on the column header ("Fix all 12 teams missing the Slack-bot
 * binding").
 */
export interface TeamScopeKindSummary {
  kind: TeamScopeKind;
  fail_count: number;
  unknown_count: number;
  pass_count: number;
}

export interface TeamScopeMatrix {
  /**
   * Rows sorted: failing first (highest fail_count first), then
   * unknown-bearing rows, then passing rows. Within each tier rows
   * sort alphabetically by slug so reads are stable across reloads.
   * `team-personal` always sorts last within its tier so the
   * structural row sits at the end of its bucket.
   */
  rows: TeamScopeRow[];
  /** Kinds present in the input. Always equal to `TEAM_SCOPE_KIND_ORDER` for non-empty input. */
  kinds: TeamScopeKind[];
  /** Per-kind summary used to power the column-header Fix buttons. */
  kind_summary: Record<TeamScopeKind, TeamScopeKindSummary>;
  /** Overall counts (sum across all rows). */
  summary: {
    teams: number;
    fail_count: number;
    unknown_count: number;
    pass_count: number;
  };
  /**
   * Phase 3 (spec 2026-05-24-derive-team-from-channel) retired the
   * DM-mode advisory invariant. The field is kept on the type for
   * back-compat with renderers that read `advisory` and treat `null`
   * as "no advisory" — the matrix builder always sets this to `null`.
   */
  advisory: KeycloakInvariant | null;
}

/**
 * Match the BFF's ID format: `team_scope.<slug>.<kind>` for the
 * per-cell invariants. We intentionally use a regex (not a split)
 * so slugs containing dots (none today, but defensive) don't
 * collapse the parsing.
 */
const TEAM_SCOPE_ID_RE = /^team_scope\.([^.]+)\.(active_team_mapper|optional_on_slack_bot|optional_on_webex_bot|default_on_obo_audience)$/;

const PERSONAL_SLUG = "team-personal";

/**
 * Pivot a flat list of invariants (from any group) into the team-scope matrix.
 *
 * Tolerates extra invariants from other groups — they're filtered out —
 * so callers don't need to pre-narrow. Unknown / malformed IDs are
 * dropped silently rather than thrown; the corresponding cell ends up
 * `undefined`, which the renderer treats the same as N/A.
 */
export function buildTeamScopeMatrix(items: KeycloakInvariant[]): TeamScopeMatrix {
  const rowMap = new Map<string, TeamScopeRow>();

  for (const item of items) {
    if (item.group !== "team-scope") continue;
    const match = TEAM_SCOPE_ID_RE.exec(item.id);
    if (!match) continue;
    const slug = match[1];
    const kind = match[2] as TeamScopeKind;
    let row = rowMap.get(slug);
    if (!row) {
      row = {
        slug,
        isPersonal: slug === PERSONAL_SLUG,
        cells: {},
        fail_count: 0,
        unknown_count: 0,
        pass_count: 0,
        total_cells: 0,
      };
      rowMap.set(slug, row);
    }
    if (row.cells[kind]) {
      // Duplicate emission for the same (slug, kind) is a BFF bug —
      // keep the *worst* status so the row doesn't silently report
      // green if a later duplicate is also a pass. This is defensive;
      // the tests pin that duplicates land in the matrix safely.
      const existing = row.cells[kind] as KeycloakInvariant;
      const worse = worseStatus(existing.status, item.status);
      if (worse !== existing.status) {
        adjustRowCounts(row, existing.status, -1);
        row.cells[kind] = item;
        adjustRowCounts(row, item.status, +1);
      }
      continue;
    }
    row.cells[kind] = item;
    row.total_cells += 1;
    adjustRowCounts(row, item.status, +1);
  }

  // Build kind summaries off the *post-merge* row map (so duplicates
  // are counted correctly).
  const kind_summary: Record<TeamScopeKind, TeamScopeKindSummary> = {
    active_team_mapper: emptyKindSummary("active_team_mapper"),
    optional_on_slack_bot: emptyKindSummary("optional_on_slack_bot"),
    optional_on_webex_bot: emptyKindSummary("optional_on_webex_bot"),
    default_on_obo_audience: emptyKindSummary("default_on_obo_audience"),
  };
  for (const row of rowMap.values()) {
    for (const kind of TEAM_SCOPE_KIND_ORDER) {
      const cell = row.cells[kind];
      if (!cell) continue;
      const sum = kind_summary[kind];
      if (cell.status === "fail") sum.fail_count += 1;
      else if (cell.status === "unknown") sum.unknown_count += 1;
      else sum.pass_count += 1;
    }
  }

  const rows = [...rowMap.values()].sort(compareRows);
  const summary = rows.reduce(
    (acc, row) => {
      acc.fail_count += row.fail_count;
      acc.unknown_count += row.unknown_count;
      acc.pass_count += row.pass_count;
      return acc;
    },
    { teams: rows.length, fail_count: 0, unknown_count: 0, pass_count: 0 },
  );

  return {
    rows,
    kinds: [...TEAM_SCOPE_KIND_ORDER],
    kind_summary,
    summary,
    advisory: null,
  };
}

function emptyKindSummary(kind: TeamScopeKind): TeamScopeKindSummary {
  return { kind, fail_count: 0, unknown_count: 0, pass_count: 0 };
}

function adjustRowCounts(row: TeamScopeRow, status: KeycloakInvariantStatus, delta: number) {
  if (status === "fail") row.fail_count += delta;
  else if (status === "unknown") row.unknown_count += delta;
  else row.pass_count += delta;
}

const STATUS_RANK: Record<KeycloakInvariantStatus, number> = {
  fail: 0,
  unknown: 1,
  pass: 2,
};

function worseStatus(a: KeycloakInvariantStatus, b: KeycloakInvariantStatus): KeycloakInvariantStatus {
  return STATUS_RANK[a] <= STATUS_RANK[b] ? a : b;
}

/**
 * Sort rows: failing first (more fails sort first), then unknown,
 * then passing. Within each tier sort alphabetically by slug so
 * scrolls are deterministic. `team-personal` is pushed to the end
 * of its tier so the structural row sits at the bottom of its
 * bucket and never visually dominates.
 */
function compareRows(a: TeamScopeRow, b: TeamScopeRow): number {
  if (a.fail_count !== b.fail_count) return b.fail_count - a.fail_count;
  if (a.unknown_count !== b.unknown_count) return b.unknown_count - a.unknown_count;
  if (a.isPersonal && !b.isPersonal) return 1;
  if (!a.isPersonal && b.isPersonal) return -1;
  return a.slug.localeCompare(b.slug);
}

/**
 * Filter the matrix rows in-place for the panel's search /
 * "failing only" / per-kind chip UI. Returns a new `rows` array —
 * the matrix itself is not mutated. Counts are unchanged so the
 * summary strip always shows the unfiltered totals.
 */
export interface FilterTeamScopeMatrixInput {
  rows: TeamScopeRow[];
  /** Substring match against the slug (case-insensitive). Empty = no filter. */
  slugQuery?: string;
  /** When true, hide rows whose `fail_count + unknown_count === 0`. */
  failingOnly?: boolean;
  /**
   * When non-empty, hide rows whose failing-or-unknown cells don't
   * touch any of these kinds. Each chip is an "include" filter and
   * they OR together: if the user picks `slack_bot` and `audience`,
   * a row with a failing `slack_bot` cell matches even if its
   * `audience` cell is green.
   */
  failureKinds?: TeamScopeKind[];
}

export function filterTeamScopeRows(input: FilterTeamScopeMatrixInput): TeamScopeRow[] {
  const slugQuery = (input.slugQuery ?? "").trim().toLowerCase();
  const failingOnly = Boolean(input.failingOnly);
  const failureKinds = input.failureKinds ?? [];
  return input.rows.filter((row) => {
    if (slugQuery && !row.slug.toLowerCase().includes(slugQuery)) return false;
    if (failingOnly && row.fail_count === 0 && row.unknown_count === 0) return false;
    if (failureKinds.length > 0) {
      const touchesAny = failureKinds.some((kind) => {
        const cell = row.cells[kind];
        return cell !== undefined && cell.status !== "pass";
      });
      if (!touchesAny) return false;
    }
    return true;
  });
}
