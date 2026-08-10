import type { OpenFgaTupleKey } from "@/lib/rbac/openfga";
import type { MigrationApplyResult, MigrationPlanResult, MigrationSampleDiff } from "./types";

/**
 * Drop the legacy `team_kb_ownership` collection — OpenFGA is now the single
 * source of truth for which knowledge bases a team can access.
 *
 * BACKGROUND. Team↔KB grants used to live in a dedicated `team_kb_ownership`
 * Mongo collection AND in OpenFGA `knowledge_base` tuples. The admin KB views,
 * the RAG-tool datasource-binding check, and the team-card KB count all read
 * the Mongo collection, while the RAG-server upload path wrote only OpenFGA
 * tuples — so an uploaded datasource with an owning team never showed up until
 * an admin re-assigned it by hand (the documented Zanzibar dual-store
 * anti-pattern). Every consumer now reads grants live from OpenFGA
 * (`listTeamKbGrants`), matching agents/skills/workflows, so the Mongo
 * collection is dead weight that can only re-introduce drift.
 *
 * WHAT THIS DOES.
 *   1. Backfill any (team, kb) grant present in a `team_kb_ownership` row as the
 *      canonical OpenFGA tuple for its permission — strictly additive and
 *      idempotent (the writer no-ops identical writes). This is
 *      belt-and-suspenders on top of `knowledge_base_shared_team_grants_backfill_v1`
 *      (declared as a dependency), so no grant is lost if a row was edited after
 *      that backfill ran.
 *   2. Drop the `team_kb_ownership` collection.
 *
 * Permission → tuple mapping (mirrors the kb-assignments write path so reads
 * via `listTeamKbGrants` see exactly the same grants):
 *   - read   → team:<slug>#member reader   knowledge_base:<id>
 *   - ingest → team:<slug>#member ingestor knowledge_base:<id>
 *   - admin  → team:<slug>#admin  manager  knowledge_base:<id>
 *
 * Idempotent: a re-run finds no collection and is a no-op.
 */

export const DROP_TEAM_KB_OWNERSHIP_MIGRATION_ID = "drop_team_kb_ownership_v1";
export const DROP_TEAM_KB_OWNERSHIP_CONFIRMATION = "DROP team_kb_ownership collection";
export const TEAM_KB_OWNERSHIP_COLLECTION = "team_kb_ownership";

/** OpenFGA id charset guard (same as registry.ts). */
const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

function isOpenFgaId(value: unknown): value is string {
  return typeof value === "string" && OPENFGA_ID_PATTERN.test(value);
}

/** Permission stored on a `team_kb_ownership` row. */
type KbPermission = "read" | "ingest" | "admin";

const VALID_PERMISSIONS = new Set<KbPermission>(["read", "ingest", "admin"]);

/** (userset relation, tuple relation) the team holds for each permission. */
const KB_PERMISSION_TO_TUPLE: Record<
  KbPermission,
  { subjectRelation: "member" | "admin"; tupleRelation: string }
> = {
  read: { subjectRelation: "member", tupleRelation: "reader" },
  ingest: { subjectRelation: "member", tupleRelation: "ingestor" },
  admin: { subjectRelation: "admin", tupleRelation: "manager" },
};

export interface DropTeamKbOwnershipRewrites {
  /** Tuples to (re)write so no row-only grant is lost before the drop. */
  tupleWrites: OpenFgaTupleKey[];
  /** Diagnostics surfaced in the plan. */
  warnings: string[];
  rowsScanned: number;
  rowsResolved: number;
  unresolvedTeams: number;
  invalidIdentifiers: number;
}

function dedupeTuples(tuples: OpenFgaTupleKey[]): OpenFgaTupleKey[] {
  const seen = new Set<string>();
  const out: OpenFgaTupleKey[] = [];
  for (const tuple of tuples) {
    const key = `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tuple);
  }
  return out;
}

/**
 * Pure: compute the backfill tuples from the `team_kb_ownership` rows. No I/O.
 *
 * Each row carries `kb_ids[]` and `kb_permissions{}`; a kb_id absent from
 * `kb_permissions` defaults to `read` (matching the kb-assignments PUT default).
 */
export function computeDropTeamKbOwnershipRewrites(
  ownershipDocs: Array<Record<string, unknown>>,
  teamSlugByMongoId: Map<string, string>,
): DropTeamKbOwnershipRewrites {
  const tuples: OpenFgaTupleKey[] = [];
  const warnings: string[] = [];
  let rowsScanned = 0;
  let rowsResolved = 0;
  let unresolvedTeams = 0;
  let invalidIdentifiers = 0;

  for (const doc of ownershipDocs) {
    rowsScanned += 1;
    const teamId = typeof doc.team_id === "string" ? doc.team_id.trim() : "";
    if (!teamId) continue;
    const slug = teamSlugByMongoId.get(teamId);
    if (!slug || !isOpenFgaId(slug)) {
      unresolvedTeams += 1;
      warnings.push(`Skipping team_kb_ownership row with unresolved team_id=${teamId}`);
      continue;
    }

    const kbIds = Array.isArray(doc.kb_ids) ? doc.kb_ids : [];
    const permissions =
      doc.kb_permissions && typeof doc.kb_permissions === "object"
        ? (doc.kb_permissions as Record<string, unknown>)
        : {};
    // Union of explicit ids + any id that only appears in the permissions map.
    const allKbIds = new Set<string>();
    for (const candidate of kbIds) {
      if (typeof candidate === "string" && candidate.trim()) allKbIds.add(candidate.trim());
    }
    for (const candidate of Object.keys(permissions)) {
      if (candidate.trim()) allKbIds.add(candidate.trim());
    }

    let perRowResolved = false;
    for (const kbId of allKbIds) {
      if (!isOpenFgaId(kbId)) {
        invalidIdentifiers += 1;
        warnings.push(`Skipping team_kb_ownership kb_id=${kbId} for team ${slug} (not a valid OpenFGA id)`);
        continue;
      }
      const rawPermission = permissions[kbId];
      const permission: KbPermission = VALID_PERMISSIONS.has(rawPermission as KbPermission)
        ? (rawPermission as KbPermission)
        : "read";
      const { subjectRelation, tupleRelation } = KB_PERMISSION_TO_TUPLE[permission];
      tuples.push({
        user: `team:${slug}#${subjectRelation}`,
        relation: tupleRelation,
        object: `knowledge_base:${kbId}`,
      });
      perRowResolved = true;
    }
    if (perRowResolved) rowsResolved += 1;
  }

  return {
    tupleWrites: dedupeTuples(tuples),
    warnings,
    rowsScanned,
    rowsResolved,
    unresolvedTeams,
    invalidIdentifiers,
  };
}

export interface DropTeamKbOwnershipInputs {
  ownershipDocs: Array<Record<string, unknown>>;
  teamSlugByMongoId: Map<string, string>;
  /** True when the `team_kb_ownership` collection still exists in Mongo. */
  collectionExists: boolean;
}

export function planDropTeamKbOwnershipMigration(
  input: DropTeamKbOwnershipInputs,
): MigrationPlanResult {
  const rewrites = computeDropTeamKbOwnershipRewrites(
    input.ownershipDocs,
    input.teamSlugByMongoId,
  );

  const sampleDiffs: MigrationSampleDiff[] = [];
  for (const tuple of rewrites.tupleWrites.slice(0, 9)) {
    sampleDiffs.push({
      collection: "openfga_tuples",
      id: `${tuple.user} ${tuple.relation} ${tuple.object}`,
      before: {},
      after: { ...tuple },
    });
  }
  if (input.collectionExists) {
    sampleDiffs.push({
      collection: TEAM_KB_OWNERSHIP_COLLECTION,
      id: TEAM_KB_OWNERSHIP_COLLECTION,
      before: { exists: true },
      after: { dropped: true },
    });
  }

  const warnings = [...rewrites.warnings];
  if (input.collectionExists) {
    warnings.push(
      "Dropping the `team_kb_ownership` collection is irreversible. Grants are backfilled to OpenFGA first; back up MongoDB if you want to retain the raw rows.",
    );
  }

  return {
    migration_id: DROP_TEAM_KB_OWNERSHIP_MIGRATION_ID,
    release: "0.6.0",
    schema_area: "team_kb_ownership",
    kind: "explicit",
    from_version: 2,
    to_version: 3,
    counts: {
      ownership_rows_scanned: rewrites.rowsScanned,
      ownership_rows_resolved: rewrites.rowsResolved,
      unresolved_teams: rewrites.unresolvedTeams,
      invalid_identifiers: rewrites.invalidIdentifiers,
      tuple_writes_planned: rewrites.tupleWrites.length,
      collection_dropped: input.collectionExists ? 1 : 0,
    },
    warnings,
    sample_diffs: sampleDiffs,
    tuple_writes_planned: rewrites.tupleWrites.length,
    confirmation: DROP_TEAM_KB_OWNERSHIP_CONFIRMATION,
  };
}

export interface ApplyDropTeamKbOwnershipInput {
  ownershipDocs: Array<Record<string, unknown>>;
  teamSlugByMongoId: Map<string, string>;
  collectionExists: boolean;
  actor: string;
  now: string;
  /** Writes the backfill tuples; returns the ACTUAL count written. */
  writeTuples: (writes: OpenFgaTupleKey[]) => Promise<{ writes: number }>;
  /** Drops the `team_kb_ownership` collection; returns true when it existed. */
  dropCollection: (name: string) => Promise<boolean>;
}

export async function applyDropTeamKbOwnershipMigration(
  input: ApplyDropTeamKbOwnershipInput,
): Promise<MigrationApplyResult> {
  const plan = planDropTeamKbOwnershipMigration({
    ownershipDocs: input.ownershipDocs,
    teamSlugByMongoId: input.teamSlugByMongoId,
    collectionExists: input.collectionExists,
  });
  const rewrites = computeDropTeamKbOwnershipRewrites(
    input.ownershipDocs,
    input.teamSlugByMongoId,
  );

  // Tuples first: ensure every row-only grant exists in OpenFGA BEFORE the
  // collection is dropped, so a crash between the two steps leaves access
  // intact (the drop would just re-run, finding the collection already gone).
  let tupleWrites = 0;
  if (rewrites.tupleWrites.length > 0) {
    const result = await input.writeTuples(rewrites.tupleWrites);
    tupleWrites = result.writes;
  }

  const dropped = await input.dropCollection(TEAM_KB_OWNERSHIP_COLLECTION);

  return {
    ...plan,
    applied_counts: {
      tuple_writes_applied: tupleWrites,
      collection_dropped: dropped ? 1 : 0,
    },
    applied_at: input.now,
    applied_by: input.actor,
  };
}
