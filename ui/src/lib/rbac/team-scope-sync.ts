/**
 * Spec 104 / spec 2026-05-24-derive-team-from-channel — startup auto-sync of
 * Keycloak RBAC mappings.
 *
 * On server boot we run the BFF-owned Keycloak RBAC reconciliation migration.
 * Before Phase 3 of the channel-team derivation spec, this also materialized
 * per-team `team-<slug>` client scopes. Phase 3 removed that surface: team
 * identity is now derived from the channel→team mapping at message time, so
 * the reconciliation only repairs OBO permissions and any non-team Keycloak
 * wiring still required by the bots.
 *
 * The helper is idempotent and records its status in Mongo migration
 * collections. Failures are logged but never thrown — we don't want a
 * transient Keycloak outage to take the whole Web UI backend down.
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
