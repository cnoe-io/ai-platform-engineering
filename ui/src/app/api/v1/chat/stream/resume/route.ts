/**
 * POST /api/v1/chat/stream/resume — Harness Gateway resume entry point.
 *
 * Body: { conversation_id, agent_id, resume_data, protocol?, trace_id? }
 * Response: SSE stream (text/event-stream)
 */

import { createAuthzTraceContext } from "@/lib/rbac/authz-tracing";
import {
resolveHarnessGatewayTarget,
unsupportedHarnessResume,
} from "@/lib/harness-gateway";
import { requireAgentUsePermission } from "@/lib/rbac/openfga-agent-authz";
import { NextRequest,NextResponse } from "next/server";
import { requireConversationWriteAccess } from "../../_conversation-authz";
import {
authenticateRequest,
getDynamicAgentsConfig,
proxySSEStream,
} from "../../_helpers";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

export async function POST(request: NextRequest): Promise<Response> {
  // Authenticate caller (session cookie or Bearer token)
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

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

  if (!body.conversation_id || !body.agent_id || body.resume_data === undefined) {
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

  const conversationAuthzResponse = await requireConversationWriteAccess(
    authResult,
    String(body.conversation_id),
  );
  if (conversationAuthzResponse) return conversationAuthzResponse;

  const target = await resolveHarnessGatewayTarget(String(body.agent_id));
  if (target instanceof NextResponse) return target;
  if (target.kind === "harness_engine") return unsupportedHarnessResume();

  // Preserve the existing Dynamic Agents resume path.
  const daConfig = getDynamicAgentsConfig();
  if (daConfig instanceof NextResponse) return daConfig;
  const backendUrl = `${daConfig.dynamicAgentsUrl}/api/v1/chat/stream/resume`;

  return proxySSEStream(
    backendUrl,
    JSON.stringify(body),
    authResult,
    "[stream/resume]",
  );
}
