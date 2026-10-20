/**
 * POST /api/v1/chat/stream/resume — agent operation routed by server-owned bindings.
 *
 * Body: { conversation_id, agent_id, resume_data, protocol?, trace_id? }
 * Response: SSE stream (text/event-stream)
 */

import { createAuthzTraceContext } from "@/lib/rbac/authz-tracing";
import { proxyAgenticAppAssistantStream } from "@/lib/agentic-apps/assistant-stream";
import { requireAgentUsePermission } from "@/lib/rbac/openfga-agent-authz";
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
export const maxDuration = 960; // App deadlines may exceed the default agent deadline.

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

  if (!body || typeof body.conversation_id !== "string" || !body.conversation_id || typeof body.agent_id !== "string" || !body.agent_id || body.resume_data === undefined) {
    return NextResponse.json(
      { success: false, error: "Missing required fields: conversation_id, agent_id, resume_data" },
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

  const appResponse = await proxyAgenticAppAssistantStream(
    appRequest, authResult, conversationAuthz.conversation, body, "resume",
  );
  if (appResponse) return appResponse;

  const daConfig = getDynamicAgentsConfig();
  if (daConfig instanceof NextResponse) return daConfig;

  body = {
    ...body,
    conversation_id: await resolveConversationRuntimeId(
      conversationAuthz.conversation,
    ),
  };

  // Forward body as-is to DA backend (same path, same body format)
  const backendUrl = `${daConfig.dynamicAgentsUrl}/api/v1/chat/stream/resume`;

  return proxySSEStream(
    backendUrl,
    JSON.stringify(body),
    authResult,
    "[stream/resume]",
  );
}
