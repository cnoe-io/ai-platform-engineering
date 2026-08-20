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
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import {
  appendMessage,
  clearSession,
  ensureSession,
  loadHistory,
  loadSessionById,
  setSdkSessionId,
} from "@/lib/tome/chat-history-store";
import { findActiveChatRun } from "@/lib/tome/chat-run-store";
import type { ChatPart, ChatRole, ModelProvenance } from "@/types/tome";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

const userIdOf = (email?: string): string => email ?? "anonymous";

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const requestedSessionId = request.nextUrl.searchParams.get("sessionId");

  let session: Awaited<ReturnType<typeof loadHistory>>["session"] = null;
  let messages: Awaited<ReturnType<typeof loadHistory>>["messages"] = [];
  let readOnly = false;
  let sessionOwner: string | null = null;
  let activeRun: Awaited<ReturnType<typeof findActiveChatRun>> = null;

  if (requestedSessionId) {
    const loaded = await loadSessionById(requestedSessionId, tctx.projectId);
    session = loaded.session;
    messages = loaded.messages;
    sessionOwner = session?.user_id ?? null;

    if (session && session.user_id !== userIdOf(tctx.user.email)) {
      const { session: authSession } = await getAuthFromBearerOrSession(request);
      await requireRbacPermission(authSession, "admin_ui", "view");
      readOnly = true;
    }
  } else {
    // Resolve the active run before loading messages. If it completes between
    // these reads, either the final message is already in history or the run
    // id still lets the browser replay its buffered events.
    activeRun = await findActiveChatRun(
      tctx.projectId,
      userIdOf(tctx.user.email),
    );
    const loaded = await loadHistory(tctx.projectId, userIdOf(tctx.user.email));
    session = loaded.session;
    messages = loaded.messages;
  }

  return successResponse({
    session: session
      ? {
          id: session._id,
          sdkSessionId: session.sdk_session_id ?? null,
          userId: session.user_id ?? null,
        }
      : null,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      parts: m.parts ?? null,
      model: m.model ?? null,
      model_provenance: m.model_provenance ?? null,
    })),
    readOnly,
    sessionOwner,
    activeRun: activeRun
      ? { id: activeRun._id, sessionId: activeRun.session_id }
      : null,
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
    model?: string;
    model_provenance?: ModelProvenance;
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
    typeof body.model === "string" ? body.model : undefined,
    body.model_provenance && typeof body.model_provenance === "object"
      ? body.model_provenance
      : undefined,
  );

  if (typeof body.sdk_session_id === "string" && body.sdk_session_id) {
    await setSdkSessionId(session._id!, body.sdk_session_id);
  }

  return successResponse({
    sessionId: session._id,
    messageId: message._id,
  });
});

// Clear: start a fresh session. Old history is left untouched (not deleted),
// just no longer active — see `clearSession` for the "why".
export const DELETE = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const session = await clearSession(tctx.projectId, userIdOf(tctx.user.email));
  return successResponse({ sessionId: session._id });
});
