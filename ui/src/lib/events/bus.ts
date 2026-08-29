/**
 * Durable, provider-neutral CAIPE event bus.
 *
 * MongoDB is the initial transport because every CAIPE UI deployment already
 * has it. The public boundary is the event envelope + subscriber contract, so
 * a Redis Streams, NATS, or Kafka adapter can replace this store later.
 */

import { getCollection } from "@/lib/mongodb";
import { caipeEventSubscribers } from "@/lib/events/subscribers";
import type { CaipeEvent, CaipeEventDelivery } from "@/lib/events/types";

export const CAIPE_EVENTS_COLLECTION = "caipe_events";
export const CAIPE_EVENT_DELIVERIES_COLLECTION = "caipe_event_deliveries";

const RETENTION_MS = Math.max(
  24 * 60 * 60 * 1000,
  Number(process.env.CAIPE_EVENT_RETENTION_MS) || 30 * 24 * 60 * 60 * 1000,
);

export interface PublishCaipeEventResult {
  duplicate: boolean;
  subscribers: string[];
}

export async function publishCaipeEvent(
  event: Omit<CaipeEvent, "expires_at">,
): Promise<PublishCaipeEventResult> {
  const events = await getCollection<CaipeEvent>(CAIPE_EVENTS_COLLECTION);
  const deliveries = await getCollection<CaipeEventDelivery>(
    CAIPE_EVENT_DELIVERIES_COLLECTION,
  );
  const expiresAt = new Date(event.received_at.getTime() + RETENTION_MS);
  let duplicate = false;
  try {
    await events.insertOne({ ...event, expires_at: expiresAt });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    duplicate = true;
  }

  const subscribers = caipeEventSubscribers
    .filter((subscriber) => subscriber.matches({ ...event, expires_at: expiresAt }))
    .map((subscriber) => subscriber.id);
  const now = new Date();
  await Promise.all(
    subscribers.map((subscriberId) =>
      deliveries.updateOne(
        { _id: `${event._id}:${subscriberId}` },
        {
          $setOnInsert: {
            event_id: event._id,
            subscriber_id: subscriberId,
            status: "pending",
            attempts: 0,
            available_at: now,
            created_at: now,
            updated_at: now,
            expires_at: expiresAt,
          },
        },
        { upsert: true },
      ),
    ),
  );

  // The durable delivery remains pending if the process exits here. The
  // startup worker will reclaim it; this kick only minimizes latency.
  void import("@/lib/events/worker").then(({ kickCaipeEventWorker }) =>
    kickCaipeEventWorker(),
  );
  return { duplicate, subscribers };
}
