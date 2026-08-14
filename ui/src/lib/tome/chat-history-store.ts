/**
 * Durable, tome-OWNED chat persistence. Writes only to `tome_chat_sessions` /
 * `tome_chat_messages` (never CAIPE's `conversations`), so tome chats are
 * isolated by construction — they never surface in CAIPE's global history.
 *
 * v1 model: one active session per (project_id, user_id). The session holds the
 * Claude Agent SDK `sdk_session_id` as a resume hint; the messages are the
 * durable transcript (with the interleaved `parts` render model preserved).
 * Server-only.
 */

import {
  getTomeChatSessionsCollection,
  getTomeChatMessagesCollection,
} from "@/lib/tome/mongo-collections";
import type {
  ChatMessage,
  ChatPart,
  ChatRole,
  ChatSession,
  ModelProvenance,
} from "@/types/tome";

/** The most-recent session for (project, user), or null. Never creates. */
export async function findActiveSession(
  projectId: string,
  userId: string,
): Promise<ChatSession | null> {
  const sessions = await getTomeChatSessionsCollection();
  return sessions.findOne(
    { project_id: projectId, user_id: userId },
    { sort: { updated_at: -1 } },
  );
}

/**
 * Resolve the session to write to: an explicit `sessionId` if it exists, else
 * the active session, else a freshly created one.
 */
export async function ensureSession(
  projectId: string,
  userId: string,
  sessionId?: string,
): Promise<ChatSession> {
  const sessions = await getTomeChatSessionsCollection();
  if (sessionId) {
    const byId = await sessions.findOne({
      _id: sessionId,
      project_id: projectId,
      user_id: userId,
    });
    if (byId) return byId;
  }
  const active = await findActiveSession(projectId, userId);
  if (active) return active;

  const now = new Date();
  const session: ChatSession = {
    _id: crypto.randomUUID(),
    project_id: projectId,
    user_id: userId,
    created_at: now,
    updated_at: now,
  };
  await sessions.insertOne(session);
  return session;
}

/** Transcript for a session, oldest first. */
export async function loadMessages(
  sessionId: string,
): Promise<ChatMessage[]> {
  const messages = await getTomeChatMessagesCollection();
  return messages
    .find({ session_id: sessionId })
    .sort({ created_at: 1 })
    .toArray();
}

/** Active session + its messages for the project/user (no session → empty). */
export async function loadHistory(
  projectId: string,
  userId: string,
): Promise<{ session: ChatSession | null; messages: ChatMessage[] }> {
  const session = await findActiveSession(projectId, userId);
  if (!session?._id) return { session: null, messages: [] };
  return { session, messages: await loadMessages(session._id) };
}

/** Load a specific session by id (admin / deep-link reads). */
export async function loadSessionById(
  sessionId: string,
  projectId?: string,
): Promise<{ session: ChatSession | null; messages: ChatMessage[] }> {
  const sessions = await getTomeChatSessionsCollection();
  const query: { _id: string; project_id?: string } = { _id: sessionId };
  if (projectId) query.project_id = projectId;
  const session = await sessions.findOne(query);
  if (!session?._id) return { session: null, messages: [] };
  return { session, messages: await loadMessages(session._id) };
}

/** Append a message to a session and bump the session's `updated_at`. */
export async function appendMessage(
  session: ChatSession,
  role: ChatRole,
  content: string,
  parts?: ChatPart[],
  model?: string,
  modelProvenance?: ModelProvenance,
): Promise<ChatMessage> {
  const messages = await getTomeChatMessagesCollection();
  const sessions = await getTomeChatSessionsCollection();
  const now = new Date();
  const message: ChatMessage = {
    _id: crypto.randomUUID(),
    session_id: session._id!,
    project_id: session.project_id,
    role,
    content,
    ...(parts && parts.length ? { parts } : {}),
    ...(model ? { model } : {}),
    ...(modelProvenance ? { model_provenance: modelProvenance } : {}),
    created_at: now,
  };
  await messages.insertOne(message);
  await sessions.updateOne(
    { _id: session._id },
    { $set: { updated_at: now } },
  );
  return message;
}

/** Persist the latest SDK session id on the session (resume hint). */
export async function setSdkSessionId(
  sessionId: string,
  sdkSessionId: string,
): Promise<void> {
  const sessions = await getTomeChatSessionsCollection();
  await sessions.updateOne(
    { _id: sessionId },
    { $set: { sdk_session_id: sdkSessionId, updated_at: new Date() } },
  );
}

/**
 * Start over: create a brand-new, empty session for (project, user). The old
 * session/messages are left in place (untouched history, just no longer
 * "active" — `findActiveSession` sorts by `updated_at` so the new row wins on
 * the very next read) rather than deleted, so Clear can't destroy data.
 */
export async function clearSession(
  projectId: string,
  userId: string,
): Promise<ChatSession> {
  const sessions = await getTomeChatSessionsCollection();
  const now = new Date();
  const session: ChatSession = {
    _id: crypto.randomUUID(),
    project_id: projectId,
    user_id: userId,
    created_at: now,
    updated_at: now,
  };
  await sessions.insertOne(session);
  return session;
}
