/**
 * Event Store — Server-side event persistence for workflow steps.
 *
 * Stores StreamEvent[] to MongoDB `stream_events` collection.
 * One document per (source_type, source_id) pair.
 *
 * Index: { source_type: 1, source_id: 1 } (unique)
 */

import { getCollection } from "@/lib/mongodb";
import type { StreamEvent } from "@/lib/streaming/types";

// ═══════════════════════════════════════════════════════════════
// Document Shape
// ═══════════════════════════════════════════════════════════════

export interface StreamEventDocument {
  _id?: unknown;
  source_type: "workflow_step" | "message";
  source_id: string;
  events: StreamEvent[];
  event_count: number;
  created_at: Date;
  updated_at: Date;
}

const COLLECTION = "stream_events";

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

/**
 * Append events to an existing document (upsert).
 * Uses $push + $inc for atomic append.
 */
export async function appendEvents(
  sourceType: StreamEventDocument["source_type"],
  sourceId: string,
  events: StreamEvent[],
): Promise<void> {
  if (events.length === 0) return;

  const col = await getCollection<StreamEventDocument>(COLLECTION);
  const now = new Date();

  await col.updateOne(
    { source_type: sourceType, source_id: sourceId },
    {
      $push: { events: { $each: events } },
      $inc: { event_count: events.length },
      $set: { updated_at: now },
      $setOnInsert: { source_type: sourceType, source_id: sourceId, created_at: now },
    },
    { upsert: true },
  );
}

/**
 * Read events for a specific source, optionally from a given index.
 * Returns events after sinceIndex (0-based).
 */
export async function readEvents(
  sourceType: StreamEventDocument["source_type"],
  sourceId: string,
  sinceIndex?: number,
): Promise<StreamEvent[]> {
  const col = await getCollection<StreamEventDocument>(COLLECTION);
  const doc = await col.findOne(
    { source_type: sourceType, source_id: sourceId },
    sinceIndex !== undefined
      ? { projection: { events: { $slice: [sinceIndex, Number.MAX_SAFE_INTEGER] } } }
      : undefined,
  );

  return doc?.events ?? [];
}

/**
 * Read all events for a workflow run, grouped by step index.
 * Finds all documents matching "wfrun-{runId}-step-*" pattern.
 */
export async function readEventsByRun(
  runId: string,
): Promise<Map<number, StreamEvent[]>> {
  const col = await getCollection<StreamEventDocument>(COLLECTION);
  const prefix = `${runId}-step-`;
  const docs = await col
    .find({
      source_type: "workflow_step",
      source_id: { $regex: `^${prefix}` },
    })
    .toArray();

  const result = new Map<number, StreamEvent[]>();
  for (const doc of docs) {
    // source_id format: "wfrun-xxx-step-0", "wfrun-xxx-step-1", etc.
    const stepStr = doc.source_id.slice(prefix.length);
    const stepIndex = parseInt(stepStr, 10);
    if (!isNaN(stepIndex)) {
      result.set(stepIndex, doc.events);
    }
  }

  return result;
}

/**
 * Ensure indexes exist. Call once on app startup.
 */
export async function ensureEventStoreIndexes(): Promise<void> {
  const col = await getCollection<StreamEventDocument>(COLLECTION);
  await col.createIndex(
    { source_type: 1, source_id: 1 },
    { unique: true, name: "source_type_source_id_unique" },
  );
}
