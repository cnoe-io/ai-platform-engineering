/**
 * Spec 104 — startup auto-sync of per-team Keycloak client scopes.
 *
 * On server boot we walk every team in Mongo and call
 * `ensureTeamClientScope(slug)` for each one. This handles three cases:
 *
 *   1. Brand-new team that was created while this BFF was down (the
 *      sibling instance created the Mongo doc but failed to reach KC).
 *   2. Existing teams that pre-date the slug field — we backfill
 *      `slug` from `name` and create the matching scope.
 *   3. Drift between Mongo and Keycloak after a manual KC restore.
 *
 * Helper is idempotent: it only mutates KC when something is missing.
 *
 * Failures are logged but never thrown — we don't want a transient KC
 * outage to take the whole BFF down. Subsequent team CRUD calls use the
 * synchronous `ensureTeamClientScope` path and DO surface errors to the
 * admin, so any team that ends up unprovisioned here will be repaired
 * on its next admin interaction.
 */
import { isMongoDBConfigured, getCollection } from "@/lib/mongodb";
import {
  ensureTeamClientScope,
  isValidTeamSlug,
} from "@/lib/rbac/keycloak-admin";

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

interface TeamRow {
  _id: unknown;
  name?: string;
  slug?: string;
}

export async function syncTeamScopesOnStartup(): Promise<void> {
  if (!isMongoDBConfigured) {
    console.log("[TeamScopeSync] Mongo not configured; skipping");
    return;
  }
  // Allow ops to opt out (e.g. local dev without a real Keycloak).
  if (process.env.SKIP_TEAM_SCOPE_SYNC === "1") {
    console.log("[TeamScopeSync] SKIP_TEAM_SCOPE_SYNC=1; skipping");
    return;
  }
  if (!process.env.KEYCLOAK_URL) {
    console.log("[TeamScopeSync] KEYCLOAK_URL not set; skipping");
    return;
  }

  let teamsCol;
  try {
    teamsCol = await getCollection("teams");
  } catch (err) {
    console.error("[TeamScopeSync] Could not open teams collection:", err);
    return;
  }

  const rows = (await teamsCol
    .find({}, { projection: { name: 1, slug: 1 } })
    .toArray()) as TeamRow[];

  if (rows.length === 0) {
    console.log("[TeamScopeSync] No teams in Mongo; nothing to sync");
    return;
  }

  let ok = 0;
  let backfilled = 0;
  let failed = 0;

  for (const row of rows) {
    let slug = (row.slug || "").trim().toLowerCase();
    if (!slug) {
      slug = deriveSlug(row.name || "");
      if (!slug || !isValidTeamSlug(slug)) {
        console.error(
          `[TeamScopeSync] Could not derive slug for team _id=${String(row._id)} name=${row.name}; skipping`
        );
        failed++;
        continue;
      }
      try {
        await teamsCol.updateOne(
          { _id: row._id as never },
          { $set: { slug, updated_at: new Date() } }
        );
        backfilled++;
      } catch (err) {
        console.error(
          `[TeamScopeSync] Failed to backfill slug for _id=${String(row._id)}:`,
          err
        );
        failed++;
        continue;
      }
    }

    if (!isValidTeamSlug(slug)) {
      console.error(
        `[TeamScopeSync] Team _id=${String(row._id)} has invalid slug "${slug}"; skipping`
      );
      failed++;
      continue;
    }

    try {
      await ensureTeamClientScope(slug);
      ok++;
    } catch (err) {
      console.error(
        `[TeamScopeSync] ensureTeamClientScope failed for slug=${slug}:`,
        err
      );
      failed++;
    }
  }

  console.log(
    `[TeamScopeSync] Done: ok=${ok} backfilled=${backfilled} failed=${failed} total=${rows.length}`
  );
}
