/**
 * POST /api/v1/chat/stream/start — agent stream routed by server-owned bindings.
 *
 * Body: { message, conversation_id, agent_id, protocol?, trace_id?, client_context? }
 * Response: SSE stream (text/event-stream)
 */

import { createAuthzTraceContext } from "@/lib/rbac/authz-tracing";
import { requireAgentUsePermission } from "@/lib/rbac/openfga-agent-authz";
import { findAgenticAppAssistantStream } from "@/lib/agentic-apps/assistant-stream";
import { POST as proxyAgenticAppStream } from "@/app/api/agentic-apps/runtime/[appId]/[[...path]]/route";
import { getAgentId } from "@/types/a2a";
import { NextRequest,NextResponse } from "next/server";
import {
authorizeConversationWriteAccess,
resolveConversationRuntimeId,
} from "../../_conversation-authz";
import {
authenticateRequest,
getDynamicAgentsConfig,
proxySSEStream,
} from "../../_helpers";

export const runtime = "nodejs";
export const maxDuration = 960; // Allows long native app streams plus cleanup.

export async function POST(request: NextRequest): Promise<Response> {
  // Authenticate caller (session cookie or Bearer token)
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const appRequest = request.clone();
  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  if (!body.message || !body.conversation_id || !body.agent_id) {
    return NextResponse.json(
      { success: false, error: "Missing required fields: message, conversation_id, agent_id" },
      { status: 400 },
    );
  }

  const traceContext = createAuthzTraceContext(request.headers.get("traceparent"));
  authResult.traceparent = traceContext.traceparent;

  const authzResponse = await requireAgentUsePermission({
    subject: authResult.subject,
    agentId: body.agent_id,
    email: authResult.email,
    tenantId: authResult.tenantId,
    traceparent: traceContext.traceparent,
    isServiceAccount: authResult.isServiceAccount,
  });
  if (authzResponse) return authzResponse;

  const conversationAuthz = await authorizeConversationWriteAccess(
    authResult,
    String(body.conversation_id),
  );
  if (conversationAuthz.denial) return conversationAuthz.denial;

  const conversation = conversationAuthz.conversation;
  if (conversation.client_type === "webex") {
    const savedAgentId = getAgentId(conversation);
    const nativeStream = savedAgentId && findAgenticAppAssistantStream(savedAgentId);
    if (nativeStream) {
      if (body.agent_id !== savedAgentId) {
        return NextResponse.json({ success: false, error: "Agent does not match this conversation" }, { status: 409 });
      }
      if (authResult.isServiceAccount || !authResult.subject) {
        return NextResponse.json({ success: false, error: "Interactive user identity required" }, { status: 403 });
      }
      // The installed app proxy re-authenticates the linked user and enforces
      // the app's launch and HTTP policy before forwarding this AG-UI request.
      const response = await proxyAgenticAppStream(appRequest, {
        params: Promise.resolve({ appId: nativeStream.appId, path: nativeStream.path }),
      });
      if (response.ok && !response.headers.get("content-type")?.includes("text/event-stream")) {
        await response.body?.cancel();
        return NextResponse.json({ success: false, error: "Assistant stream did not return SSE" }, { status: 502 });
      }
      if (!response.ok) return response;
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-cache, no-transform");
      headers.set("X-Accel-Buffering", "no");
      return new Response(response.body, { status: response.status, headers });
    }
  }

  const daConfig = getDynamicAgentsConfig();
  if (daConfig instanceof NextResponse) return daConfig;

  body = {
    ...body,
    conversation_id: await resolveConversationRuntimeId(
      conversationAuthz.conversation,
    ),
  };

  // Forward body as-is to DA backend (same path, same body format)
  const backendUrl = `${daConfig.dynamicAgentsUrl}/api/v1/chat/stream/start`;

  return proxySSEStream(
    backendUrl,
    JSON.stringify(body),
    authResult,
    "[stream/start]",
  );
}
