// Tome chat — proxies an SSE stream from the reused TTT Python agent.
//
//   POST /api/tome/projects/[slug]/chat  → text/event-stream
//
// The browser (ChatPanel) posts `{ message, sdk_session_id }`. This route
// resolves the CAIPE project into the agent's `ChatRequest` contract
// (snapshot + stable pages), POSTs to the agent at `TOME_AGENT_URL/chat`, and
// pipes the agent's SSE bytes straight back. Until `TOME_AGENT_URL` is set it
// returns 503 with a clear message (rendered inline by ChatPanel).
//
// Mirrors caipe-ui's supervisor chat proxy (`app/api/chat/stream/route.ts`).

import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { buildChatRequest } from "@/lib/tome/agent-proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);

  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) {
    throw new ApiError(
      "Tome agent is not configured (set TOME_AGENT_URL).",
      503,
      "AGENT_NOT_CONFIGURED",
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    message?: string;
    sdk_session_id?: string | null;
  };
  if (!body.message || typeof body.message !== "string") {
    throw new ApiError("`message` (string) is required", 400, "BAD_REQUEST");
  }

  const chatRequest = await buildChatRequest(tctx, {
    message: body.message,
    sdkSessionId: body.sdk_session_id ?? null,
  });

  const upstream = await fetch(`${agentUrl.replace(/\/$/, "")}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chatRequest),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    throw new ApiError(
      `Agent chat failed (${upstream.status}). ${detail.slice(0, 500)}`,
      502,
      "AGENT_ERROR",
    );
  }

  // Pipe the agent's SSE stream straight through to the browser.
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
