// Per-(project, repo) poll cursor for the source-activity feed. Stores
// the timestamp of the newest event we've already emitted so each poll only
// fetches deltas. Also carries the replica-safe poll claim.

import { getCollection } from "@/lib/mongodb";

const COLLECTION = "tome_source_cursors";

interface SourceCursorDoc {
  _id: string; // `${projectId}:${source}:${repo}`
  project_id: string;
  source: string;
  repo: string;
  last_event_ts: string | null; // ISO of the newest emitted event
  updated_at: Date;
}

function cursorId(projectId: string, source: string, repo: string): string {
  return `${projectId}:${source}:${repo}`;
}

export async function getCursor(
  projectId: string,
  source: string,
  repo: string,
): Promise<string | null> {
  const col = await getCollection<SourceCursorDoc>(COLLECTION);
  const doc = await col.findOne({ _id: cursorId(projectId, source, repo) });
  return doc?.last_event_ts ?? null;
}

export async function setCursor(
  projectId: string,
  source: string,
  repo: string,
  lastEventTs: string,
): Promise<void> {
  const col = await getCollection<SourceCursorDoc>(COLLECTION);
  await col.updateOne(
    { _id: cursorId(projectId, source, repo) },
    {
      $set: { last_event_ts: lastEventTs, updated_at: new Date() },
      $setOnInsert: { project_id: projectId, source, repo },
    },
    { upsert: true },
  );
}

interface PollClaimDoc {
  _id: string; // `poll:${projectId}`
  last_poll_started_at: Date;
}

/**
 * Atomically claim the right to poll `projectId` now, if the last claim is at
 * least `intervalMs` old. Replica-safe: the compare-and-set means only one
 * worker across replicas proceeds per interval. Returns true if claimed.
 */
export async function claimProjectPoll(
  projectId: string,
  now: Date,
  intervalMs: number,
): Promise<boolean> {
  const col = await getCollection<PollClaimDoc>(COLLECTION);
  const id = `poll:${projectId}`;
  const cutoff = new Date(now.getTime() - intervalMs);
  // Flip the timestamp only if it's stale (or the doc is new). One writer wins.
  const res = await col.updateOne(
    { _id: id, last_poll_started_at: { $lt: cutoff } },
    { $set: { last_poll_started_at: now } },
  );
  if (res.modifiedCount === 1) return true;
  // First-ever poll for this project: no doc yet. Insert-if-absent; the unique
  // _id makes the insert atomic, so only one racer creates it.
  try {
    await col.insertOne({ _id: id, last_poll_started_at: now });
    return true;
  } catch {
    return false; // another racer inserted first
  }
}
