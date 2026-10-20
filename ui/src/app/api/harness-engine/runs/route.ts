import { authorizeConversationWriteAccess, resolveConversationRuntimeId } from "@/app/api/v1/chat/_conversation-authz";
import { resolveHarnessGatewayTarget } from "@/lib/harness-gateway";
import { authenticateRequest } from "@/lib/da-proxy";
import { getHarnessEngineConfig, proxyHarnessEngine } from "@/lib/harness-engine-proxy";
import { createAuthzTraceContext } from "@/lib/rbac/authz-tracing";
import { requireAgentUsePermission } from "@/lib/rbac/openfga-agent-authz";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }
  if (![body.agent_id, body.conversation_id, body.message].every((value) => typeof value === "string" && value.trim())) {
    return NextResponse.json({ success: false, error: "agent_id, conversation_id and message are required" }, { status: 400 });
  }
  auth.traceparent = createAuthzTraceContext(request.headers.get("traceparent")).traceparent;
  const authz = await requireAgentUsePermission({
    subject: auth.subject,
    agentId: body.agent_id,
    email: auth.email,
    tenantId: auth.tenantId,
    traceparent: auth.traceparent,
    isServiceAccount: auth.isServiceAccount,
  });
  if (authz) return authz;
  if (!body.conversation_id) {
    return NextResponse.json(
      { success: false, error: "Missing required field: conversation_id" },
      { status: 400 },
    );
  }
  const conversationAuthz = await authorizeConversationWriteAccess(
    auth,
    String(body.conversation_id),
  );
  if (conversationAuthz.denial) return conversationAuthz.denial;
  body.conversation_id = await resolveConversationRuntimeId(conversationAuthz.conversation);
  const target = await resolveHarnessGatewayTarget(String(body.agent_id), { conversationId: String(body.conversation_id), admit: true });
  if (target instanceof NextResponse) return target;
  if (target.kind !== "harness_engine") return NextResponse.json(
    { success: false, error: "This conversation uses the native chat runtime" }, { status: 409 },
  );

  body.expected_harness_id = target.harnessId;
  const config = getHarnessEngineConfig();
  if (config instanceof NextResponse) return config;
  return proxyHarnessEngine(config, auth, "/api/v1/runs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
