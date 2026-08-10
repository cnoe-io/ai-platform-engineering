// Background scheduler for IdP directory syncs. Without this, the "Enable
// background sync" toggle + schedule in the Identity Sync admin tab are inert —
// settings persist but nothing ever fires. This module is the missing half: a
// once-a-minute tick that checks each enabled connector's schedule and kicks
// off a run through the same path as the manual "Sync Now" button.
//
// Scope today: in-process timer started from instrumentation.ts. It is safe to
// run on every replica because each fire is claimed atomically per UTC minute
// (claimScheduledFire) and run creation has its own concurrency guard, so at
// most one run fires per minute per connector regardless of replica count.

import { isConnectorConfigured, isImplementedConnector } from "@/lib/rbac/idp-connectors";
import { createSyncRun, executeSyncRun } from "@/lib/rbac/idp-sync-runner";
import { claimScheduledFire, listIdpSyncRuns, listIdpSyncSettings } from "@/lib/rbac/idp-sync-store";

import { cronMatches } from "./cron";
import type { IdpSyncSettings } from "./mongo-collections";

// One tick per minute. The minute granularity matches cron's resolution and
// keeps Mongo chatter low (a handful of reads per minute).
const TICK_INTERVAL_MS = 60 * 1000;

// Synthetic actor recorded on scheduled runs, distinguishing them from
// `triggered_by_user` emails on manual runs in the Sync History.
const SCHEDULER_ACTOR = "scheduler";

/** UTC minute key, e.g. "2026-06-16T02:00", used to dedupe fires per minute. */
function utcMinuteKey(now: Date): string {
  return now.toISOString().slice(0, 16);
}

/**
 * Decide whether a connector is due to sync at `now`. Returns false for
 * disabled connectors and unparseable schedules. Exposed for unit tests.
 *
 *  - cron mode: due exactly on the minutes the expression matches (UTC).
 *  - interval mode: due when the last run started at least
 *    `sync_interval_minutes` ago, or there has never been a run.
 */
export async function isConnectorDue(settings: IdpSyncSettings, now: Date): Promise<boolean> {
  if (!settings.enabled) return false;

  if (settings.schedule_mode === "cron") {
    return cronMatches(settings.sync_cron, now);
  }

  // interval mode
  const intervalMs = Math.max(1, settings.sync_interval_minutes) * 60 * 1000;
  const [lastRun] = await listIdpSyncRuns(settings.provider_id, 1);
  if (!lastRun) return true; // never run → sync on the first enabled tick
  const lastStartedMs = new Date(lastRun.started_at).getTime();
  return now.getTime() - lastStartedMs >= intervalMs;
}

/**
 * Evaluate one connector and fire a scheduled run when due. Skips connectors
 * that aren't implemented, configured, or due. Claims the minute atomically so
 * concurrent ticks (across replicas) don't double-fire.
 */
async function maybeFireForConnector(settings: IdpSyncSettings, now: Date): Promise<void> {
  const provider = settings.provider_id;

  // Skip silently when there's nothing runnable: unknown connector, or creds
  // not set (firing would only produce failed rows on every tick).
  if (!isImplementedConnector(provider) || !isConnectorConfigured(provider)) return;

  if (!(await isConnectorDue(settings, now))) return;

  // Cross-replica dedupe: only the writer that flips last_fire_minute proceeds.
  const claimed = await claimScheduledFire(provider, utcMinuteKey(now));
  if (!claimed) return;

  const run = await createSyncRun({ provider, actor: SCHEDULER_ACTOR, triggeredBy: "schedule" });
  if (run.status === "already_running") {
    console.log(`[IdpSync] scheduler: ${provider} due but a run is already in progress; skipping`);
    return;
  }

  console.log(`[IdpSync] scheduler: firing ${provider} run ${run.runId} (${utcMinuteKey(now)} UTC)`);
  // Don't await: a sync can take tens of seconds, and one connector shouldn't
  // delay the tick for the others. executeSyncRun catches its own errors and
  // records the outcome on the run row.
  void executeSyncRun(run.runId, provider, SCHEDULER_ACTOR);
}

/**
 * One scheduler pass: evaluate every configured connector. A failure on one
 * connector is logged and never aborts the others. Exposed for unit tests.
 */
export async function tickIdpSyncScheduler(now: Date): Promise<void> {
  let settingsList: IdpSyncSettings[];
  try {
    settingsList = await listIdpSyncSettings();
  } catch (err) {
    console.error(
      `[IdpSync] scheduler: failed to load sync settings: ` +
        (err instanceof Error ? err.message : String(err))
    );
    return;
  }

  for (const settings of settingsList) {
    try {
      await maybeFireForConnector(settings, now);
    } catch (err) {
      console.error(
        `[IdpSync] scheduler: error evaluating ${settings.provider_id}: ` +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the once-a-minute scheduler loop. Idempotent: a second call is a no-op
 * so a hot-reload or double instrumentation invocation can't stack timers. Ticks
 * are self-guarded (errors caught in tickIdpSyncScheduler), and overlapping
 * ticks are prevented by a simple in-flight flag.
 */
export function startIdpSyncScheduler(): void {
  if (timer) return;
  console.log("[IdpSync] background sync scheduler started (tick every 60s, UTC)");

  let running = false;
  const runTick = async () => {
    if (running) return; // skip if the previous tick is still going
    running = true;
    try {
      await tickIdpSyncScheduler(new Date());
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void runTick(), TICK_INTERVAL_MS);
  // Don't keep the event loop alive solely for this timer.
  timer.unref?.();
}

/** Stop the scheduler loop (used by tests and for clean shutdown). */
export function stopIdpSyncScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
