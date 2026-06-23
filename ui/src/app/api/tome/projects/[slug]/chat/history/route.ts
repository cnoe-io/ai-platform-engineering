// Tome chat history — durable, tome-owned transcript persistence.
//
//   GET  /api/tome/projects/[slug]/chat/history  → active session + messages
//   POST /api/tome/projects/[slug]/chat/history  → append a message (+sdk id)
//
// Writes only to tome's own `tome_chat_*` collections (see chat-history-store),
// so tome chats never appear in CAIPE's global conversation list. The streaming
// turn itself stays on the sibling `chat` route; this route is the persistence
// side-channel the browser calls on load and after each turn.

import { NextRequest } from "next/server";

import {
  ApiError,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import {
  appendMessage,
  ensureSession,
  loadHistory,
  setSdkSessionId,
} from "@/lib/tome/chat-history-store";
import type { ChatPart, ChatRole } from "@/types/tome";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

const userIdOf = (email?: string): string => email ?? "anonymous";

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const { session, messages } = await loadHistory(
    tctx.projectId,
    userIdOf(tctx.user.email),
  );
  return successResponse({
    session: session
      ? { id: session._id, sdkSessionId: session.sdk_session_id ?? null }
      : null,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      parts: m.parts ?? null,
    })),
  });
});

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);

  const body = (await request.json().catch(() => ({}))) as {
    role?: ChatRole;
    content?: string;
    parts?: ChatPart[];
    sdk_session_id?: string | null;
    session_id?: string | null;
  };

  if (body.role !== "user" && body.role !== "assistant") {
    throw new ApiError("`role` must be 'user' or 'assistant'", 400, "BAD_REQUEST");
  }
  if (typeof body.content !== "string") {
    throw new ApiError("`content` (string) is required", 400, "BAD_REQUEST");
  }

  const session = await ensureSession(
    tctx.projectId,
    userIdOf(tctx.user.email),
    body.session_id ?? undefined,
  );

  const message = await appendMessage(
    session,
    body.role,
    body.content,
    Array.isArray(body.parts) ? body.parts : undefined,
  );

  if (typeof body.sdk_session_id === "string" && body.sdk_session_id) {
    await setSdkSessionId(session._id!, body.sdk_session_id);
  }

  return successResponse({
    sessionId: session._id,
    messageId: message._id,
  });
});
