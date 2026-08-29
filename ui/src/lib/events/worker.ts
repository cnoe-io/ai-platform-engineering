/** Replica-safe at-least-once delivery worker for the CAIPE event bus. */

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  CAIPE_EVENT_DELIVERIES_COLLECTION,
  CAIPE_EVENTS_COLLECTION,
} from "@/lib/events/bus";
import { findCaipeEventSubscriber } from "@/lib/events/subscribers";
import type { CaipeEvent, CaipeEventDelivery } from "@/lib/events/types";

const TICK_MS = Math.max(500, Number(process.env.CAIPE_EVENT_TICK_MS) || 2000);
const LEASE_MS = Math.max(5000, Number(process.env.CAIPE_EVENT_LEASE_MS) || 30_000);
const MAX_ATTEMPTS = Math.max(1, Number(process.env.CAIPE_EVENT_MAX_ATTEMPTS) || 8);
const BATCH_SIZE = Math.max(1, Number(process.env.CAIPE_EVENT_BATCH_SIZE) || 25);

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : "Unknown subscriber error";
}

export async function runCaipeEventWorkerOnce(): Promise<number> {
  const deliveries = await getCollection<CaipeEventDelivery>(
    CAIPE_EVENT_DELIVERIES_COLLECTION,
  );
  const events = await getCollection<CaipeEvent>(CAIPE_EVENTS_COLLECTION);
  const now = new Date();
  const candidates = await deliveries
    .find({
      $or: [
        { status: "pending", available_at: { $lte: now } },
        { status: "processing", lease_until: { $lte: now } },
      ],
    })
    .sort({ available_at: 1 })
    .limit(BATCH_SIZE)
    .toArray();

  let processed = 0;
  for (const candidate of candidates) {
    const claim = await deliveries.updateOne(
      {
        _id: candidate._id,
        $or: [
          { status: "pending", available_at: { $lte: now } },
          { status: "processing", lease_until: { $lte: now } },
        ],
      },
      {
        $set: {
          status: "processing",
          lease_until: new Date(Date.now() + LEASE_MS),
          updated_at: new Date(),
        },
        $inc: { attempts: 1 },
      },
    );
    if (claim.modifiedCount !== 1) continue;
    processed += 1;

    const subscriber = findCaipeEventSubscriber(candidate.subscriber_id);
    const event = await events.findOne({ _id: candidate.event_id });
    try {
      if (!subscriber) throw new Error(`Unknown subscriber: ${candidate.subscriber_id}`);
      if (!event) throw new Error(`Missing event: ${candidate.event_id}`);
      await subscriber.handle(event);
      await deliveries.updateOne(
        { _id: candidate._id, status: "processing" },
        {
          $set: {
            status: "completed",
            completed_at: new Date(),
            updated_at: new Date(),
          },
          $unset: { lease_until: "", last_error: "" },
        },
      );
    } catch (error) {
      const attempts = candidate.attempts + 1;
      const deadLetter = attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
      await deliveries.updateOne(
        { _id: candidate._id, status: "processing" },
        {
          $set: {
            status: deadLetter ? "dead_letter" : "pending",
            available_at: new Date(Date.now() + backoffMs),
            updated_at: new Date(),
            last_error: errorMessage(error),
          },
          $unset: { lease_until: "" },
        },
      );
    }
  }
  return processed;
}

export function kickCaipeEventWorker(): void {
  if (running) return;
  running = true;
  void runCaipeEventWorkerOnce()
    .catch((error) => console.error("[caipe-event-worker] delivery failed:", error))
    .finally(() => {
      running = false;
    });
}

export function startCaipeEventWorker(): void {
  if (
    timer ||
    !isMongoDBConfigured ||
    (process.env.CAIPE_EVENT_BUS_ENABLED !== "true" &&
      process.env.TOME_GITHUB_WEBHOOK_ENABLED !== "true")
  ) {
    return;
  }
  kickCaipeEventWorker();
  timer = setInterval(kickCaipeEventWorker, TICK_MS);
  timer.unref?.();
}

export function stopCaipeEventWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
