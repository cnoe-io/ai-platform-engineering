import { randomUUID } from "crypto";

import { getTomeChatRunsCollection } from "@/lib/tome/mongo-collections";
import type {
  ChatRun,
  ChatRunEvent,
  ChatRunStatus,
  ChatSession,
} from "@/types/tome";

const RUN_RETENTION_MS = 24 * 60 * 60 * 1000;

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + RUN_RETENTION_MS);
}

export async function createChatRun(session: ChatSession): Promise<ChatRun> {
  const now = new Date();
  const run: ChatRun = {
    _id: randomUUID(),
    session_id: session._id!,
    project_id: session.project_id,
    user_id: session.user_id,
    status: "starting",
    events: [],
    last_event_id: 0,
    created_at: now,
    updated_at: now,
    expires_at: expiryFrom(now),
  };
  const runs = await getTomeChatRunsCollection();
  await runs.insertOne(run);
  return run;
}

export async function markChatRunRunning(runId: string): Promise<void> {
  const runs = await getTomeChatRunsCollection();
  await runs.updateOne(
    { _id: runId, status: "starting" },
    { $set: { status: "running", updated_at: new Date() } },
  );
}

export async function appendChatRunEvents(
  runId: string,
  events: ChatRunEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const runs = await getTomeChatRunsCollection();
  await runs.updateOne(
    { _id: runId, status: { $in: ["starting", "running"] } },
    {
      $push: { events: { $each: events } },
      $set: {
        last_event_id: events[events.length - 1].id,
        updated_at: new Date(),
      },
    },
  );
}

export async function finishChatRun(
  runId: string,
  status: Extract<ChatRunStatus, "completed" | "failed">,
  error?: string,
): Promise<void> {
  const now = new Date();
  const runs = await getTomeChatRunsCollection();
  await runs.updateOne(
    { _id: runId },
    {
      $set: {
        status,
        updated_at: now,
        finished_at: now,
        expires_at: expiryFrom(now),
        ...(error ? { error } : {}),
      },
    },
  );
}

export async function findActiveChatRun(
  projectId: string,
  userId: string,
): Promise<ChatRun | null> {
  const runs = await getTomeChatRunsCollection();
  return runs.findOne(
    {
      project_id: projectId,
      user_id: userId,
      status: { $in: ["starting", "running"] },
    },
    { sort: { created_at: -1 } },
  );
}

export async function loadOwnedChatRun(
  runId: string,
  projectId: string,
  userId: string,
): Promise<ChatRun | null> {
  const runs = await getTomeChatRunsCollection();
  return runs.findOne({ _id: runId, project_id: projectId, user_id: userId });
}
