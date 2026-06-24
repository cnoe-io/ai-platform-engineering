/**
 * Next.js instrumentation hook.
 *
 * The register() function runs once on server startup before the server
 * handles any requests. Same semantics as FastAPI's lifespan hook.
 *
 * Used to seed config-driven agents, MCP servers, and LLM models from
 * a YAML config file into MongoDB. The Spec 104 per-team Keycloak
 * client-scope sync is invoked from inside applySeedConfig() (see
 * comment there) — Turbopack tree-shook a separate dynamic import here,
 * so we piggyback on the seed-config chunk that is reliably emitted.
 *
 * See: https://nextjs.org/docs/app/guides/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applySeedConfig } = await import("./lib/seed-config");
  await applySeedConfig();

  // Start the IdP directory-sync scheduler so the "Enable background sync"
  // schedule (Identity Sync admin tab) actually fires. Idempotent and
  // replica-safe (per-minute fires are claimed atomically in Mongo).
  // A failure here (e.g. an optional connector SDK that can't load) must not
  // take down the web server; log and continue serving requests.
  try {
    const { startIdpSyncScheduler } = await import(
      "./lib/rbac/idp-sync-scheduler"
    );
    startIdpSyncScheduler();
  } catch (err) {
    console.warn("[instrumentation] IdP sync scheduler not started:", err);
  }
}
