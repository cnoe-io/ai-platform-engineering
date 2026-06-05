// assisted-by Claude Claude-opus-4-7
//
// One-shot migration for spec 2026-05-26-canonical-team-membership.
//
// Walks `db.teams` and for every team document that still carries the
// legacy `members[]` embedded array, makes sure each row is represented
// by an active `team_membership_sources` document, then $unsets the
// embedded array. After this script runs once, `team_membership_sources`
// is the only place "who's on team X" is recorded.
//
// Usage:
//
//   # Dry-run (default) — prints the plan, makes NO writes.
//   MONGODB_URI=mongodb://localhost:27017 npx tsx \
//     scripts/migrate-canonical-team-membership.ts
//
//   # Apply — actually upserts source rows and $unsets members[].
//   APPLY=true MONGODB_URI=mongodb://localhost:27017 npx tsx \
//     scripts/migrate-canonical-team-membership.ts
//
// Idempotent: re-running after a successful apply is a no-op (the
// source rows already exist; `$unset` of an already-missing field is
// also a no-op).

import { MongoClient, ObjectId, type Collection, type Db } from "mongodb";

export const MIGRATION_ID = "canonical_team_membership_v1";
export const MIGRATION_ACTOR = `migration:${MIGRATION_ID}`;

/** Shape of a legacy `members[]` entry. */
export interface LegacyTeamMember {
  user_id?: unknown;
  role?: unknown;
  added_at?: unknown;
  added_by?: unknown;
}

/** Subset of the teams collection schema this migration cares about. */
export interface TeamDocLite {
  _id: unknown;
  slug?: unknown;
  members?: LegacyTeamMember[];
}

/** Subset of the team_membership_sources schema this migration writes. */
export interface MembershipSourceRow {
  team_id: string;
  team_slug: string;
  user_email: string;
  user_subject?: string;
  relationship: "member" | "admin";
  source_type: "manual";
  managed: false;
  status: "active";
  created_by: string;
  created_at: string;
  first_seen_at: string;
  last_seen_at: string;
  last_applied_at: string;
}

/** Pure planning result — derived from a snapshot of the two collections. */
export interface MigrationPlan {
  teamsScanned: number;
  teamsWithLegacyMembers: number;
  rowsToBackfill: MembershipSourceRow[];
  teamsToUnset: string[];
  skipped: Array<{ team_id: string; reason: string }>;
  warnings: string[];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalize a legacy `members[]` role into the canonical-store
 * `relationship` vocabulary. Owners collapse to "admin" — this matches
 * the semantics every reader (auth gates, API consumers) is already
 * using through `findUserRoleInTeam` since commits 2/8 and 3/8.
 */
export function normalizeRelationship(role: unknown): "member" | "admin" | null {
  const s = asString(role)?.toLowerCase();
  if (s === "admin" || s === "owner") return "admin";
  if (s === "member") return "member";
  return null;
}

/**
 * Build the migration plan from a snapshot of the two collections.
 * Pure function — no I/O. The plan can be inspected/tested without
 * touching Mongo.
 *
 * `existingSources` is the set of `(team_slug, lower(email))` keys
 * that already have an active row in `team_membership_sources`.
 */
export function planCanonicalTeamMembershipMigration(input: {
  teams: TeamDocLite[];
  existingSources: Set<string>;
  now: string;
}): MigrationPlan {
  const rowsToBackfill: MembershipSourceRow[] = [];
  const teamsToUnset: string[] = [];
  const skipped: Array<{ team_id: string; reason: string }> = [];
  const warnings: string[] = [];
  let teamsWithLegacyMembers = 0;

  for (const team of input.teams) {
    const teamId = String(team._id);
    const teamSlug = asString(team.slug);
    const legacyMembers = Array.isArray(team.members) ? team.members : [];

    if (legacyMembers.length === 0) {
      // Some teams may carry a defunct `members: []` from a previous
      // codepath. Unset those too — that's exactly what we want to
      // clean up — but only if the field is actually present.
      if (team.members !== undefined) teamsToUnset.push(teamId);
      continue;
    }

    teamsWithLegacyMembers += 1;
    teamsToUnset.push(teamId);

    if (!teamSlug) {
      // No slug means we can't write a canonical source row (the
      // natural key is (team_slug, user_email)). Skip and warn; the
      // operator can fix the slug and re-run.
      skipped.push({ team_id: teamId, reason: "team has no slug" });
      warnings.push(
        `team ${teamId}: no slug; skipping ${legacyMembers.length} legacy member(s)`,
      );
      continue;
    }

    for (const member of legacyMembers) {
      const email = asString(member.user_id)?.toLowerCase();
      const relationship = normalizeRelationship(member.role);
      if (!email) {
        warnings.push(
          `team ${teamSlug} (${teamId}): skipping member with non-string user_id`,
        );
        continue;
      }
      if (!relationship) {
        warnings.push(
          `team ${teamSlug} (${teamId}): skipping ${email} with unknown role "${String(member.role)}"`,
        );
        continue;
      }
      const naturalKey = `${teamSlug}:${email}`;
      if (input.existingSources.has(naturalKey)) {
        // Already present in canonical store — skip backfill.
        continue;
      }

      rowsToBackfill.push({
        team_id: teamId,
        team_slug: teamSlug,
        user_email: email,
        // user_subject left undefined here. Live writers (login flow,
        // POST /members) resolve it from Keycloak. The startup audit
        // and any later mutation will repair it.
        relationship,
        source_type: "manual",
        managed: false,
        status: "active",
        created_by: MIGRATION_ACTOR,
        created_at: input.now,
        first_seen_at: input.now,
        last_seen_at: input.now,
        last_applied_at: input.now,
      });
    }
  }

  return {
    teamsScanned: input.teams.length,
    teamsWithLegacyMembers,
    rowsToBackfill,
    teamsToUnset,
    skipped,
    warnings,
  };
}

async function fetchExistingSources(
  sources: Collection<Record<string, unknown>>,
): Promise<Set<string>> {
  const cursor = sources.find(
    { status: "active" },
    { projection: { team_slug: 1, user_email: 1 } },
  );
  const keys = new Set<string>();
  for await (const row of cursor) {
    const slug = asString(row.team_slug);
    const email = asString(row.user_email)?.toLowerCase();
    if (slug && email) keys.add(`${slug}:${email}`);
  }
  return keys;
}

async function applyMigration(input: {
  db: Db;
  plan: MigrationPlan;
}): Promise<{ backfilled: number; unsetTeams: number }> {
  const sources = input.db.collection<Record<string, unknown>>(
    "team_membership_sources",
  );
  const teams = input.db.collection<Record<string, unknown>>("teams");

  let backfilled = 0;
  for (const row of input.plan.rowsToBackfill) {
    // Use the same natural-key upsert filter the runtime helper
    // (`upsertTeamMembershipSource`) does — (team_slug, user_email,
    // source_type) — so a re-run is a no-op even if a prior run
    // partially succeeded.
    await sources.updateOne(
      {
        team_slug: row.team_slug,
        user_email: row.user_email,
        source_type: row.source_type,
      },
      // Cast through unknown so the MongoDB driver's MatchKeysAndValues
      // doesn't reject our strictly-typed `MembershipSourceRow` for not
      // exposing a string index signature. The runtime helper
      // (`upsertTeamMembershipSource`) goes through the same dance.
      { $set: row as unknown as Record<string, unknown> },
      { upsert: true },
    );
    backfilled += 1;
  }

  let unsetTeams = 0;
  for (const teamId of input.plan.teamsToUnset) {
    // `_id` in the `teams` collection is stored as ObjectId; the planner
    // stringifies it for the plain-JSON plan. Re-coerce when both possible
    // (24-hex string) and fall back to the string form for any legacy docs
    // that happen to use a string `_id`. The OR keeps the migration safe
    // against future schema drift without needing a separate filter for
    // each case.
    const filter: Record<string, unknown> = ObjectId.isValid(teamId)
      ? { $or: [{ _id: new ObjectId(teamId) }, { _id: teamId }] }
      : { _id: teamId };
    // `$unset` against a missing field is a no-op; `matchedCount` may
    // still be 0 if the team was deleted between planning and apply,
    // which we tolerate (the migration is best-effort idempotent).
    const result = await teams.updateOne(
      filter as never,
      { $unset: { members: "" } },
    );
    if (result.matchedCount > 0) unsetTeams += 1;
  }

  return { backfilled, unsetTeams };
}

async function main(): Promise<void> {
  const apply = process.env.APPLY === "true";
  const mongoUri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE || "ai_platform_engineering";

  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    const db = client.db(databaseName);

    const teamDocs = await db
      .collection<TeamDocLite>("teams")
      .find({})
      .toArray();
    const existingSources = await fetchExistingSources(
      db.collection<Record<string, unknown>>("team_membership_sources"),
    );

    const plan = planCanonicalTeamMembershipMigration({
      teams: teamDocs,
      existingSources,
      now: new Date().toISOString(),
    });

    console.log(
      JSON.stringify(
        {
          migration: MIGRATION_ID,
          apply,
          summary: {
            teamsScanned: plan.teamsScanned,
            teamsWithLegacyMembers: plan.teamsWithLegacyMembers,
            rowsToBackfill: plan.rowsToBackfill.length,
            teamsToUnset: plan.teamsToUnset.length,
            skipped: plan.skipped.length,
            warnings: plan.warnings.length,
          },
          warnings: plan.warnings,
          skipped: plan.skipped,
        },
        null,
        2,
      ),
    );

    if (!apply) {
      console.log(
        "[dry-run] no writes performed. Re-run with APPLY=true to apply.",
      );
      return;
    }

    const result = await applyMigration({ db, plan });
    console.log(
      JSON.stringify({ migration: MIGRATION_ID, applied: result }, null, 2),
    );
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
