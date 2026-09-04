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
  if (process.env.AGENTIC_APPS_INSTALL_ENABLED === "true") {
    const { loadConfiguredAgenticApps } = await import("./lib/agentic-apps/config");
    const { validateAgenticAppTokenConfiguration } = await import(
      "./lib/agentic-apps/tokens"
    );
    const apps = loadConfiguredAgenticApps();
    validateAgenticAppTokenConfiguration();
    console.log(`[external-apps] Validated ${apps.length} configured App(s)`);
  }
  const { applySeedConfig } = await import("./lib/seed-config");
  await applySeedConfig();

  // Project the built-in Agentic App role-level "user" contract into OpenFGA
  // before the first app request; explicit user/team/admin grants remain untouched.
  try {
    const { reconcileBuiltinAgenticAppCasAccess } = await import(
      "./lib/agentic-apps/cas-reconcile"
    );
    await reconcileBuiltinAgenticAppCasAccess();
  } catch (err) {
    console.error("[instrumentation] Agentic App CAS reconcile failed closed:", err);
  }

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

  // Seed the DB-backed page-template config from the hardcoded defaults when
  // absent. Insert-if-absent only — admin edits survive restarts. Failures
  // must not take down the server; the schema.ts fallback still applies.
  try {
    const { seedPageTemplates } = await import("./lib/tome/page-templates-store");
    await seedPageTemplates();
  } catch (err) {
    console.warn("[instrumentation] Tome page-template seed skipped:", err);
  }

  // Start the Tome ingest queue worker so BHAG-cascade runs (status "queued")
  // actually get drained. Idempotent; failures must not take down the server.
  try {
    const { startIngestQueue } = await import("./lib/tome/ingest-queue");
    startIngestQueue();
  } catch (err) {
    console.warn("[instrumentation] Tome ingest queue not started:", err);
  }

  // Start the Tome source-activity feed poller. Opt-in via
  // TOME_SOURCE_FEED_ENABLED. Polls connected GitHub sources and emits
  // `source_event`s into each project's Talk room. Idempotent; failures here
  // must not take down the server.
  try {
    const { startSourceFeedPoller } = await import("./lib/tome/source-feed/poller");
    startSourceFeedPoller();
  } catch (err) {
    console.warn("[instrumentation] Tome source-feed poller not started:", err);
  }

  // Start the Tome auto-ingest scheduler. Opt-in via TOME_AUTO_INGEST_ENABLED.
  // Fires CRON-scheduled ingest runs and calendar-driven Webex meeting-series
  // runs for projects that opted in. Idempotent;
  // failures here must not take down the server.
  try {
    const { startAutoIngestScheduler } = await import("./lib/tome/auto-ingest/scheduler");
    startAutoIngestScheduler();
  } catch (err) {
    console.warn("[instrumentation] Tome auto-ingest scheduler not started:", err);
  }

  // Keep Tome's stored steward/team membership intent projected into
  // OpenFGA. The worker runs once at startup and then periodically; a Mongo
  // lease prevents multiple UI replicas from repairing the same drift.
  try {
    const { startTomeAuthorizationReconciler } = await import(
      "./lib/tome/authorization-reconcile-scheduler"
    );
    startTomeAuthorizationReconciler();
  } catch (err) {
    console.warn("[instrumentation] Tome authorization auto-repair not started:", err);
  }

  // Drain durable provider events to TOME and future autonomous-agent
  // subscribers. The Mongo lease makes this safe across UI replicas.
  try {
    const { startCaipeEventWorker } = await import("./lib/events/worker");
    startCaipeEventWorker();
  } catch (err) {
    console.warn("[instrumentation] CAIPE event worker not started:", err);
  }
}
