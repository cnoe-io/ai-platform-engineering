import type { IdpSyncRun,IdpSyncSettings } from "./mongo-collections";
import { getRbacCollection } from "./mongo-collections";

function defaultSettings(providerId: string): IdpSyncSettings {
  return {
    provider_id: providerId,
    enabled: false,
    schedule_mode: "interval",
    sync_interval_minutes: 60,
    updated_by: "system",
    updated_at: new Date(0).toISOString(),
  } as IdpSyncSettings;
}

/** Settings for one IdP connector. Returns connector defaults when unset. */
export async function getIdpSyncSettings(providerId: string): Promise<IdpSyncSettings> {
  const col = await getRbacCollection<IdpSyncSettings>("idpSyncSettings");
  const doc = await col.findOne({ provider_id: providerId });
  return doc ?? defaultSettings(providerId);
}

export async function upsertIdpSyncSettings(
  providerId: string,
  settings: Partial<Omit<IdpSyncSettings, "provider_id">>
): Promise<void> {
  const col = await getRbacCollection<IdpSyncSettings>("idpSyncSettings");
  await col.updateOne(
    { provider_id: providerId },
    { $set: { ...settings, provider_id: providerId } },
    { upsert: true }
  );
}

/** All persisted settings docs. Used by the scheduler to discover what to tick. */
export async function listIdpSyncSettings(): Promise<IdpSyncSettings[]> {
  const col = await getRbacCollection<IdpSyncSettings>("idpSyncSettings");
  return col.find({}).toArray();
}

/**
 * Atomically claim a UTC minute for a connector's scheduled fire. Returns true
 * only for the single caller that wins the compare-and-set; concurrent ticks
 * (across replicas) for the same minute get false. This is the cross-replica
 * dedupe guard: the matched document is updated only when its current
 * `last_fire_minute` differs from `minuteKey`, so the second writer matches
 * nothing.
 */
export async function claimScheduledFire(providerId: string, minuteKey: string): Promise<boolean> {
  const col = await getRbacCollection<IdpSyncSettings>("idpSyncSettings");
  const result = await col.updateOne(
    { provider_id: providerId, last_fire_minute: { $ne: minuteKey } },
    { $set: { last_fire_minute: minuteKey } }
  );
  return (result.modifiedCount ?? 0) > 0;
}

/** Recent runs for one connector, newest first. */
export async function listIdpSyncRuns(providerId: string, limit = 20): Promise<IdpSyncRun[]> {
  const col = await getRbacCollection<IdpSyncRun>("idpSyncRuns");
  return col.find({ provider_id: providerId }).sort({ started_at: -1 }).limit(limit).toArray();
}

export interface IdpSyncRunPage {
  runs: IdpSyncRun[];
  total: number;
}

export interface ListIdpSyncRunsPageOptions {
  /** 1-based page index. Defaults to 1. */
  page?: number;
  /** Rows per page. Clamped to [1, 100]. Defaults to 20. */
  pageSize?: number;
}

/**
 * One page of a connector's run history (newest first) plus the total run
 * count, for server-side offset pagination of the Sync History table.
 *
 * Provider-scoped via `provider_id` exactly like {@link listIdpSyncRuns}, so
 * any registered connector (Okta today, Duo/etc. later) paginates through the
 * same path with no per-connector code.
 */
export async function listIdpSyncRunsPage(
  providerId: string,
  opts?: ListIdpSyncRunsPageOptions
): Promise<IdpSyncRunPage> {
  const page = Math.max(1, opts?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 20));
  const col = await getRbacCollection<IdpSyncRun>("idpSyncRuns");
  const query = { provider_id: providerId };
  const [runs, total] = await Promise.all([
    col
      .find(query)
      .sort({ started_at: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    col.countDocuments(query),
  ]);
  return { runs, total };
}

export async function insertIdpSyncRun(run: Omit<IdpSyncRun, "_id">): Promise<void> {
  const col = await getRbacCollection<IdpSyncRun>("idpSyncRuns");
  await col.insertOne(run as IdpSyncRun);
}

/** Active (`running`) runs for a connector, oldest first. */
export async function listRunningIdpSyncRuns(providerId: string): Promise<IdpSyncRun[]> {
  const col = await getRbacCollection<IdpSyncRun>("idpSyncRuns");
  return col
    .find({ provider_id: providerId, status: "running" })
    .sort({ started_at: 1, id: 1 })
    .toArray();
}

// A run executes in-process via `after()`, so a pod/process restart mid-sync
// orphans its `running` row (nothing flips it to a terminal state). Liveness is
// proven by a fresh heartbeat, NOT elapsed time: the executor refreshes
// `heartbeat_at` every HEARTBEAT_INTERVAL_MS, and any `running` run whose
// heartbeat is older than HEARTBEAT_STALE_MS is considered dead. This means a
// slow-but-alive sync (large org, rate-limited) is never falsely reaped, while
// a crashed one is cleared within ~2 min: identical behavior locally and
// across k8s pods, since we reap on read rather than on a specific pod's boot.
export const HEARTBEAT_INTERVAL_MS = 20 * 1000;
const HEARTBEAT_STALE_MS = 2 * 60 * 1000;

export async function heartbeatIdpSyncRun(id: string, nowMs: number): Promise<void> {
  const col = await getRbacCollection<IdpSyncRun>("idpSyncRuns");
  await col.updateOne({ id }, { $set: { heartbeat_at: new Date(nowMs).toISOString() } });
}

/**
 * Mark dead `running` runs (stale heartbeat) as failed. Returns the count
 * reaped. Idempotent and safe to call on every read of run state. Rows
 * predating the heartbeat field fall back to `started_at`.
 */
export async function reapStaleIdpSyncRuns(providerId: string, nowMs: number): Promise<number> {
  const col = await getRbacCollection<IdpSyncRun>("idpSyncRuns");
  const cutoffIso = new Date(nowMs - HEARTBEAT_STALE_MS).toISOString();
  const result = await col.updateMany(
    {
      provider_id: providerId,
      status: "running",
      // Dead when the last heartbeat is stale; for legacy rows with no
      // heartbeat yet, fall back to when the run started.
      $or: [
        { heartbeat_at: { $lt: cutoffIso } },
        { heartbeat_at: { $exists: false }, started_at: { $lt: cutoffIso } },
      ],
    },
    {
      $set: {
        status: "failed",
        completed_at: new Date(nowMs).toISOString(),
        error_message: "Interrupted: the process stopped while the sync was running.",
      },
    }
  );
  return result.modifiedCount ?? 0;
}

export async function updateIdpSyncRun(id: string, update: Partial<IdpSyncRun>): Promise<void> {
  const col = await getRbacCollection<IdpSyncRun>("idpSyncRuns");
  await col.updateOne({ id }, { $set: update });
}
