/**
 * In-process async worker for Agentic SDLC event projection.
 *
 * The webhook receiver (T020) does the bare-minimum work synchronously:
 *   1. Verify HMAC.
 *   2. Match repo by repo_id.
 *   3. Persist the raw event with `projection_status="deferred"`.
 *   4. Enqueue the event _id on this worker, return 202 to GitHub.
 *
 * This worker then drains the queue:
 *   - Look up the persisted event.
 *   - Project to a `AgenticSdlcArtifact` upsert + (in some cases) emit a
 *     downstream `AgenticSdlcEvent` row (e.g. translating a label to a
 *     stage_transition).
 *   - Publish to the SSE bus.
 *   - Mark the source event `projection_status="projected"` and update
 *     `OnboardedRepo.webhook_last_event_at`.
 *
 * Pilot-scale: single-process, in-memory queue, single concurrency, no
 * external broker. This is consistent with the spec's "async writes to
 * dB, single in-process worker" decision.
 *
 * Two modes:
 *   - `enqueueAndStart()` — fire-and-forget; safe to call repeatedly.
 *   - `processOne()` — synchronous-ish helper used by tests and by the
 *     route handler when running in a single-tick test environment.
 *
 * Server-only module.
 */

import type { Document, ObjectId } from "mongodb";

import { recordProjectionLatency, setWorkerQueueDepth } from "@/lib/agentic-sdlc/sli";
import {
  epicTopic,
  portfolioTopic,
  publish,
  repoTopic,
} from "@/lib/agentic-sdlc/sse-bus";
import {
  getAgenticSdlcArtifactsCollection as agenticSdlcArtifacts,
  getAgenticSdlcEventsCollection as agenticSdlcEvents,
  getAgenticSdlcReposCollection as agenticSdlcRepos,
} from "@/lib/agentic-sdlc/mongo-collections";
import {
  buildArtifactUpsert,
  projectEvent,
  type ArtifactPatch,
} from "@/lib/agentic-sdlc/projector";
import type {
  OnboardedRepo,
  AgenticSdlcArtifact,
  AgenticSdlcEvent,
} from "@/types/agentic-sdlc";

// Re-export for legacy callers and tests that imported from this module.
export { buildArtifactUpsert, projectEvent };
export type { ArtifactPatch };

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

interface QueueItem {
  eventId: ObjectId;
  /** ms epoch when the event was persisted; used for projection_latency. */
  enqueuedAt: number;
}

const queue: QueueItem[] = [];
let running = false;

export function agenticSdlcWorkerQueueDepth(): number {
  return queue.length;
}

export function enqueueAgenticSdlcEvent(
  eventId: ObjectId,
  enqueuedAt: number = Date.now(),
): void {
  queue.push({ eventId, enqueuedAt });
  setWorkerQueueDepth(queue.length);
  void startWorker();
}

async function startWorker(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const item = queue.shift()!;
      setWorkerQueueDepth(queue.length);
      try {
        await processOneById(item.eventId, item.enqueuedAt);
      } catch (err) {
        // Mark failed; we'll let an operator re-queue.
        try {
          const events = await agenticSdlcEvents();
          await events.updateOne(
            { _id: item.eventId },
            { $set: { projection_status: "failed" } },
          );
        } catch {
          // Last-resort: log and move on to keep the worker draining.
        }
        // eslint-disable-next-line no-console
        console.error("[ship-loop worker] projection failed", err);
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Test/route convenience: process the head of the queue once, awaiting
 * the result. Returns true if a message was processed.
 */
export async function agenticSdlcWorkerProcessOne(): Promise<boolean> {
  const item = queue.shift();
  if (!item) return false;
  setWorkerQueueDepth(queue.length);
  await processOneById(item.eventId, item.enqueuedAt);
  return true;
}

/**
 * Synchronous-ish drain for tests.
 */
export async function agenticSdlcWorkerDrain(): Promise<number> {
  let n = 0;
  while (await agenticSdlcWorkerProcessOne()) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

async function processOneById(
  eventId: ObjectId,
  enqueuedAtMs: number,
): Promise<void> {
  const events = await agenticSdlcEvents();
  const evDoc = await events.findOne({ _id: eventId });
  if (!evDoc) return; // already removed; nothing to do.
  const ev = evDoc as AgenticSdlcEvent;

  const repos = await agenticSdlcRepos();
  const repoDoc = (await repos.findOne({
    repo_id: ev.repo_id,
  })) as OnboardedRepo | null;
  if (!repoDoc || repoDoc.offboarded_at) {
    await events.updateOne(
      { _id: eventId },
      { $set: { projection_status: "failed" } },
    );
    return;
  }

  const artifactPatch = projectEvent(ev, repoDoc);
  if (artifactPatch) {
    const artifacts = await agenticSdlcArtifacts();
    const now = new Date();
    const filter = {
      repo_id: ev.repo_id,
      kind: artifactPatch.kind,
      artifact_id: artifactPatch.artifact_id,
    };
    const update = buildArtifactUpsert(artifactPatch, ev.occurred_at, now);

    // Detect stage transition for SSE emission.
    const prior = (await artifacts.findOne(filter)) as AgenticSdlcArtifact | null;
    const priorStage = prior?.current_stage ?? null;
    const nextStage = artifactPatch.current_stage;

    await artifacts.updateOne(filter, update as unknown as Document, {
      upsert: true,
    });
    if (artifactPatch.kind === "subtask" && artifactPatch.epic_id) {
      await artifacts.deleteOne({
        repo_id: ev.repo_id,
        kind: "epic",
        artifact_id: artifactPatch.artifact_id,
      });
    }

    const final = (await artifacts.findOne(filter)) as AgenticSdlcArtifact | null;
    if (final) {
      const artifactPayload = sanitizeArtifactForSse(final);
      publish(repoTopic(ev.repo_id), {
        event: "artifact_upserted",
        data: artifactPayload,
      });
      publish(portfolioTopic(), {
        event: "artifact_upserted",
        data: artifactPayload,
      });
    }

    const topicEpicId =
      artifactPatch.kind === "epic" ? artifactPatch.artifact_id : artifactPatch.epic_id;
    if (final && topicEpicId) {
      const topic = epicTopic(ev.repo_id, topicEpicId);
      publish(topic, {
        event: "artifact_upserted",
        data: sanitizeArtifactForSse(final),
      });
      if (priorStage !== null && priorStage !== nextStage) {
        publish(topic, {
          event: "stage_transition",
          data: {
            artifact_id: final.artifact_id,
            from: priorStage,
            to: nextStage,
            reason: `event:${ev.github_event_type ?? "unknown"}`,
          },
        });
      }
      publish(topic, {
        event: "event_appended",
        data: sanitizeEventForSse(ev),
      });
    }
  }

  await events.updateOne(
    { _id: eventId },
    { $set: { projection_status: "projected" } },
  );

  await repos.updateOne(
    { repo_id: ev.repo_id },
    {
      $set: {
        webhook_status: "healthy",
        webhook_last_event_at: ev.occurred_at,
        updated_at: new Date(),
      },
    },
  );

  const eventPayload = sanitizeEventForSse(ev);
  publish(repoTopic(ev.repo_id), {
    event: "event_appended",
    data: eventPayload,
  });
  publish(portfolioTopic(), {
    event: "event_appended",
    data: eventPayload,
  });
  const webhookHealthPayload = {
    repo_id: ev.repo_id,
    status: "healthy",
    last_event_at: ev.occurred_at.toISOString(),
  };
  publish(repoTopic(ev.repo_id), {
    event: "webhook_health",
    data: webhookHealthPayload,
  });
  publish(portfolioTopic(), {
    event: "webhook_health",
    data: webhookHealthPayload,
  });

  recordProjectionLatency((Date.now() - enqueuedAtMs) / 1000);
}

// ---------------------------------------------------------------------------
// Sanitisers (strip raw payloads from SSE-bound shapes)
// ---------------------------------------------------------------------------

function sanitizeArtifactForSse(a: AgenticSdlcArtifact): Record<string, unknown> {
  const { _id, ...rest } = a;
  void _id;
  return rest;
}

function sanitizeEventForSse(e: AgenticSdlcEvent): Record<string, unknown> {
  // Strip raw payload — SSE consumers should never see it.
  const { _id, payload, ...rest } = e;
  void _id;
  void payload;
  return rest;
}

/** Test-only reset. */
export function _resetWorkerForTests(): void {
  queue.length = 0;
  setWorkerQueueDepth(0);
}
