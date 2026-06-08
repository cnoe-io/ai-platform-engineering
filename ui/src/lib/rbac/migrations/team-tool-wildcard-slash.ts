import type { OpenFgaTupleKey } from "@/lib/rbac/openfga";
import type { MigrationApplyResult, MigrationPlanResult, MigrationSampleDiff } from "./types";

/**
 * #43 — migrate legacy underscore-wildcard team tool grants to the slash form.
 *
 * team-resources historically wrote tool wildcards as `tool:<server>_*`
 * (underscore-star), but the AgentGateway bridge only enforces `tool:<server>/*`
 * (slash). So underscore grants silently failed closed once the caller-keyed
 * check went live. The route now writes slash; this migration rewrites EXISTING
 * deployments so legacy grants keep working.
 *
 * CRITICAL — dual store. The `_*` form lives in BOTH:
 *   1. OpenFGA tuples: `team:<slug>#member caller tool:<server>_*`
 *   2. Mongo `team.resources.tools[]` arrays (the team doc — read as prevTools
 *      on the next team-resources PUT).
 * Both must be rewritten consistently, else the next PUT diffs stale-Mongo(`_*`)
 * vs offered(`/*`) and thrashes. After this migration, a PUT with the same
 * logical selection computes a NO-OP diff.
 *
 * Only `<server>_*` (underscore immediately followed by trailing star) is
 * rewritten — to `<server>/*`. Underscore tool ids that are NOT wildcards
 * (e.g. `jira_search`, a real MCP tool id) are left untouched: they were never
 * the team-resources wildcard form and the bridge handles exact ids directly.
 *
 * STATUS: this module + its tests ship in PR #1780, but registry wiring (a
 * MIGRATION_DEFINITIONS entry + plan/apply loader branches in
 * ui/src/lib/rbac/migrations/registry.ts) is a FAST-FOLLOW (#43 follow-up) to
 * make it operator-runnable from the admin migrations surface. Fresh installs
 * don't need it (the team-resources route already writes slash); only existing
 * deployments with legacy `_*` grants do.
 */

export const TEAM_TOOL_WILDCARD_SLASH_MIGRATION_ID = "team_tool_wildcard_slash_v1";
export const TEAM_TOOL_WILDCARD_SLASH_CONFIRMATION = "MIGRATE team tool wildcards TO slash";

/** Matches a legacy underscore-wildcard tool object id: `<server>_*`. */
const UNDERSCORE_WILDCARD = /^(.+)_\*$/;

/** Team doc shape (only the fields this migration reads/writes). */
interface TeamResourcesDoc {
  _id: unknown;
  slug?: string;
  resources?: {
    tools?: string[];
  };
}

/** A `tool:` object id is a legacy underscore wildcard. */
export function isLegacyUnderscoreWildcard(toolId: string): boolean {
  return UNDERSCORE_WILDCARD.test(toolId);
}

/** `<server>_*` → `<server>/*`. Returns the input unchanged if not a match. */
export function toSlashWildcard(toolId: string): string {
  const m = UNDERSCORE_WILDCARD.exec(toolId);
  return m ? `${m[1]}/*` : toolId;
}

export interface TeamToolWildcardPlanInput {
  /** All team docs (only those with underscore-wildcard tools matter). */
  teams: TeamResourcesDoc[];
  /**
   * Existing OpenFGA caller→tool tuples whose object is a legacy underscore
   * wildcard (caller route should pre-filter to `tool:*_*` objects, but we
   * re-check defensively).
   */
  toolTuples: OpenFgaTupleKey[];
}

/** Internal: the concrete rewrites this migration will perform. */
export interface TeamToolWildcardRewrites {
  /** OpenFGA tuples to delete (old `_*`) then write (new `/*`). */
  tupleWrites: OpenFgaTupleKey[];
  tupleDeletes: OpenFgaTupleKey[];
  /** Per-team Mongo array rewrites: team _id → the new tools[] array. */
  mongoUpdates: Array<{ teamId: unknown; tools: string[] }>;
}

const TOOL_PREFIX = "tool:";

function tupleIsUnderscoreToolWildcard(tuple: OpenFgaTupleKey): boolean {
  return (
    tuple.relation === "caller" &&
    tuple.object.startsWith(TOOL_PREFIX) &&
    isLegacyUnderscoreWildcard(tuple.object.slice(TOOL_PREFIX.length))
  );
}

/**
 * Compute the concrete OpenFGA + Mongo rewrites. Pure — no I/O.
 */
export function computeTeamToolWildcardRewrites(
  input: TeamToolWildcardPlanInput,
): TeamToolWildcardRewrites {
  // OpenFGA: delete each `_*` tuple and write its `/*` twin (same user+relation).
  const tupleDeletes: OpenFgaTupleKey[] = [];
  const tupleWrites: OpenFgaTupleKey[] = [];
  for (const tuple of input.toolTuples) {
    if (!tupleIsUnderscoreToolWildcard(tuple)) continue;
    const oldId = tuple.object.slice(TOOL_PREFIX.length);
    tupleDeletes.push(tuple);
    tupleWrites.push({
      user: tuple.user,
      relation: tuple.relation,
      object: `${TOOL_PREFIX}${toSlashWildcard(oldId)}`,
    });
  }

  // Mongo: rewrite each team.resources.tools[] entry that's an underscore
  // wildcard. Only emit an update when the array actually changes.
  const mongoUpdates: TeamToolWildcardRewrites["mongoUpdates"] = [];
  for (const team of input.teams) {
    const tools = team.resources?.tools;
    if (!Array.isArray(tools) || tools.length === 0) continue;
    let changed = false;
    const next = tools.map((t) => {
      if (typeof t === "string" && isLegacyUnderscoreWildcard(t)) {
        changed = true;
        return toSlashWildcard(t);
      }
      return t;
    });
    if (changed) mongoUpdates.push({ teamId: team._id, tools: next });
  }

  return { tupleWrites, tupleDeletes, mongoUpdates };
}

export function planTeamToolWildcardSlashMigration(
  input: TeamToolWildcardPlanInput,
): MigrationPlanResult {
  const rewrites = computeTeamToolWildcardRewrites(input);

  const sampleDiffs: MigrationSampleDiff[] = [];
  for (const update of rewrites.mongoUpdates) {
    if (sampleDiffs.length >= 10) break;
    const before = input.teams.find((t) => t._id === update.teamId)?.resources?.tools ?? [];
    sampleDiffs.push({
      collection: "teams",
      id: String(update.teamId),
      before: { "resources.tools": before },
      after: { "resources.tools": update.tools },
    });
  }
  for (const write of rewrites.tupleWrites) {
    if (sampleDiffs.length >= 10) break;
    sampleDiffs.push({
      collection: "openfga",
      id: `${write.user} ${write.relation} ${write.object}`,
      before: { object: write.object.replace("/*", "_*") },
      after: { object: write.object },
    });
  }

  return {
    migration_id: TEAM_TOOL_WILDCARD_SLASH_MIGRATION_ID,
    release: "0.5.8",
    schema_area: "team_resources",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      teams_total: input.teams.length,
      teams_to_update: rewrites.mongoUpdates.length,
      tuple_rewrites: rewrites.tupleWrites.length,
    },
    warnings:
      rewrites.tupleWrites.length !== rewrites.tupleDeletes.length
        ? ["tuple write/delete counts differ — investigate before applying"]
        : [],
    sample_diffs: sampleDiffs,
    tuple_writes_planned: rewrites.tupleWrites.length,
    confirmation: TEAM_TOOL_WILDCARD_SLASH_CONFIRMATION,
  };
}

/** Actual counts applied by the tuple writer (vs the planned diff lengths). */
export interface TupleApplyResult {
  writes: number;
  deletes: number;
}

export interface ApplyTeamToolWildcardSlashInput extends TeamToolWildcardPlanInput {
  actor: string;
  now: string;
  /**
   * Apply the tuple diff. Returns the ACTUAL counts written/deleted so
   * applied_counts reflects reality (not the planned diff length) — the caller
   * routes writes via writeOpenFgaTuples and userset deletes via
   * deleteExactOpenFgaTuples, both of which return real {writes, deletes}.
   */
  writeTuples: (diff: {
    writes: OpenFgaTupleKey[];
    deletes: OpenFgaTupleKey[];
  }) => Promise<TupleApplyResult>;
  teamsCollection: {
    updateOne: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ) => Promise<unknown>;
  };
}

export async function applyTeamToolWildcardSlashMigration(
  input: ApplyTeamToolWildcardSlashInput,
): Promise<MigrationApplyResult> {
  const plan = planTeamToolWildcardSlashMigration(input);
  const rewrites = computeTeamToolWildcardRewrites(input);

  // OpenFGA first: write the new `/*` tuples and delete the old `_*` in one
  // diff. Doing tuples before Mongo means a crash leaves Mongo still showing the
  // old form (which the next PUT would re-reconcile) rather than a Mongo doc
  // pointing at a tuple that doesn't exist.
  let tupleResult: TupleApplyResult = { writes: 0, deletes: 0 };
  if (rewrites.tupleWrites.length > 0 || rewrites.tupleDeletes.length > 0) {
    tupleResult = await input.writeTuples({
      writes: rewrites.tupleWrites,
      deletes: rewrites.tupleDeletes,
    });
  }

  let teamsUpdated = 0;
  for (const update of rewrites.mongoUpdates) {
    await input.teamsCollection.updateOne(
      { _id: update.teamId },
      {
        $set: {
          "resources.tools": update.tools,
          "metadata.team_tool_wildcard_slash_migration": {
            migration_id: TEAM_TOOL_WILDCARD_SLASH_MIGRATION_ID,
            migrated_at: input.now,
            migrated_by: input.actor,
          },
        },
      },
    );
    teamsUpdated += 1;
  }

  return {
    ...plan,
    applied_counts: {
      teams_updated: teamsUpdated,
      // ACTUAL counts from the writer (#57) — not the planned diff lengths, so
      // a partial/no-op apply reports what truly changed instead of over- or
      // under-reporting.
      tuple_writes_applied: tupleResult.writes,
      tuple_deletes_applied: tupleResult.deletes,
    },
    applied_at: input.now,
    applied_by: input.actor,
  };
}
