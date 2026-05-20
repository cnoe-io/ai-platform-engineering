/**
 * Spec 104 — startup auto-sync of Keycloak RBAC mappings.
 *
 * On server boot we run the BFF-owned Keycloak RBAC reconciliation migration.
 * It walks every team in Mongo and reconciles the Keycloak client scopes and
 * OBO permissions required by Slack/Webex bot impersonation. This handles three cases:
 *
 *   1. Brand-new team that was created while this Web UI backend was down (the
 *      sibling instance created the Mongo doc but failed to reach KC).
 *   2. Existing teams that pre-date the slug field — we backfill
 *      `slug` from `name` and create the matching scope.
 *   3. Drift between Mongo and Keycloak after a manual KC restore.
 *
 * Helper is idempotent and records its status in Mongo migration collections.
 *
 * Failures are logged but never thrown — we don't want a transient KC
 * outage to take the whole Web UI backend down. Subsequent team CRUD calls use the
 * synchronous `ensureTeamClientScope` path and DO surface errors to the
 * admin, so any team that ends up unprovisioned here will be repaired
 * on its next admin interaction.
 */
import { isMongoDBConfigured } from "@/lib/mongodb";
import { runKeycloakRbacStartupMigration } from "@/lib/rbac/keycloak-rbac-reconciliation";

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

  const result = await runKeycloakRbacStartupMigration({ actor: "webui-startup" });
  console.log(
    `[TeamScopeSync] Keycloak RBAC migration ${result.status}: ` +
      `teams=${result.counts.team_scopes_reconciled ?? 0} warnings=${result.warnings.length}`
  );
}
