/**
 * In-process SSE fanout bus for the Ship Loop.
 *
 * Pilot-scale: a single Next.js Node process holds all subscribers in
 * a Map keyed by topic. When the worker (or a UI mutation handler)
 * publishes an event, every active subscriber for that topic receives
 * it. Subscribers are SSE writers that buffer up to BACKPRESSURE_LIMIT
 * messages; on overflow we close the connection with `code="overflow"`
 * per `contracts/sse-channels.md` and the client will reconnect.
 *
 * Topics:
 *   - `epic:<repo_id>:<epic_id>`   per-Epic stream
 *   - `inbox:<user_id>`            needs-you firehose
 *
 * Server-only module. Not imported from any client component.
 */

import {
  decSseConnection,
  incSseConnection,
} from "@/lib/ship-loop/sli";

export type SseEventName =
  | "connected"
  | "artifact_upserted"
  | "event_appended"
  | "stage_transition"
  | "webhook_health"
  | "inbox_added"
  | "inbox_removed"
  | "inbox_initial"
  | "heartbeat"
  | "error";

export interface SseMessage {
  event: SseEventName;
  data: unknown;
  /** Optional id for client-side last-event-id replay (we don't use it yet). */
  id?: string;
}

export interface SseSubscriber {
  /** Stable id for de-dupe / debugging. */
  id: string;
  /** Caller's principal — used to scope inbox topics. */
  userId: string;
  /** Called for each published message in topic order. */
  send: (msg: SseMessage) => void;
  /** Called by the bus when it closes the subscriber. */
  close: (reason?: string) => void;
}

const BACKPRESSURE_LIMIT = 256;
const HEARTBEAT_INTERVAL_MS = 25_000;
// Hard cap per-user across both topics. Spec: 10.
const MAX_CONNECTIONS_PER_USER = 10;

const subscribers = new Map<string /* topic */, Set<SseSubscriber>>();
const userConnectionCount = new Map<string /* userId */, number>();
const queues = new WeakMap<SseSubscriber, SseMessage[]>();

export function epicTopic(repoId: string, epicId: string): string {
  return `epic:${repoId}:${epicId}`;
}

export function inboxTopic(userId: string): string {
  return `inbox:${userId}`;
}

/**
 * Subscribe a writer to a topic. Returns a `dispose()` to call from
 * the SSE route's `req.signal.addEventListener("abort", dispose)`.
 */
export function subscribe(
  topic: string,
  sub: SseSubscriber,
): { dispose: () => void; rejected?: "user_quota_exceeded" } {
  const current = userConnectionCount.get(sub.userId) ?? 0;
  if (current >= MAX_CONNECTIONS_PER_USER) {
    return { dispose: () => {}, rejected: "user_quota_exceeded" };
  }

  if (!subscribers.has(topic)) subscribers.set(topic, new Set());
  subscribers.get(topic)!.add(sub);
  queues.set(sub, []);
  userConnectionCount.set(sub.userId, current + 1);
  incSseConnection();

  const heartbeat = setInterval(() => {
    safeSend(sub, { event: "heartbeat", data: { t: new Date().toISOString() } });
  }, HEARTBEAT_INTERVAL_MS);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(heartbeat);
    subscribers.get(topic)?.delete(sub);
    queues.delete(sub);
    const left = (userConnectionCount.get(sub.userId) ?? 1) - 1;
    if (left <= 0) userConnectionCount.delete(sub.userId);
    else userConnectionCount.set(sub.userId, left);
    decSseConnection();
  };

  return { dispose };
}

/**
 * Publish a message to a topic. Synchronous; subscribers receive in
 * registration order. Failures in individual subscribers are isolated.
 */
export function publish(topic: string, msg: SseMessage): void {
  const set = subscribers.get(topic);
  if (!set || set.size === 0) return;
  for (const sub of set) {
    safeSend(sub, msg);
  }
}

function safeSend(sub: SseSubscriber, msg: SseMessage): void {
  const q = queues.get(sub);
  if (!q) return;
  if (q.length >= BACKPRESSURE_LIMIT) {
    try {
      sub.close("overflow");
    } catch {
      // ignored — close best-effort.
    }
    queues.delete(sub);
    subscribers.forEach((set) => set.delete(sub));
    return;
  }
  q.push(msg);
  try {
    sub.send(msg);
    // Drain virtually — we just count for backpressure detection.
    q.shift();
  } catch {
    // Subscriber send failed; drop and let the dispose handler fire on
    // the next abort signal.
  }
}

/** Test-only utility to count active subscribers on a topic. */
export function _subscriberCountForTest(topic: string): number {
  return subscribers.get(topic)?.size ?? 0;
}

/** Test-only utility to reset the bus state. */
export function _resetBusForTest(): void {
  subscribers.clear();
  userConnectionCount.clear();
}
