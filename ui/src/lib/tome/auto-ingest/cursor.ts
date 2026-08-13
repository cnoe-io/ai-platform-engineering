// Replica-safe per-project fire claim for the auto-ingest scheduler. Mirrors
// idp-sync-store's claimScheduledFire: dedupe by UTC minute key so concurrent
// ticks (across replicas) can't double-fire the same project in the same
// minute, without needing a distributed lock.

import { getCollection } from "@/lib/mongodb";

const COLLECTION = "tome_auto_ingest_cursors";

interface AutoIngestCursorDoc {
  _id: string; // `${projectId}`
  last_fire_minute?: string;
}

/**
 * Atomically claim the right to fire auto-ingest for `projectId` at
 * `minuteKey` (e.g. "2026-08-13T02:00"). Returns true only for the single
 * writer (across replicas) that flips the stored minute key.
 */
export async function claimAutoIngestFire(
  projectId: string,
  minuteKey: string,
): Promise<boolean> {
  const col = await getCollection<AutoIngestCursorDoc>(COLLECTION);
  const res = await col.updateOne(
    { _id: projectId, last_fire_minute: { $ne: minuteKey } },
    { $set: { last_fire_minute: minuteKey } },
  );
  if (res.modifiedCount === 1) return true;
  // First-ever fire for this project: no doc yet. Insert-if-absent; the
  // unique _id makes the insert atomic, so only one racer creates it.
  try {
    await col.insertOne({ _id: projectId, last_fire_minute: minuteKey });
    return true;
  } catch {
    return false; // another racer inserted first
  }
}
