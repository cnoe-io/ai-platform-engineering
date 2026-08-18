import { requireConversationWriteAccess } from "@/app/api/v1/chat/_conversation-authz";
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
  const conversationAuthz = await requireConversationWriteAccess(
    auth,
    String(body.conversation_id),
  );
  if (conversationAuthz) return conversationAuthz;

  const config = getHarnessEngineConfig();
  if (config instanceof NextResponse) return config;
  return proxyHarnessEngine(config, auth, "/api/v1/runs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
