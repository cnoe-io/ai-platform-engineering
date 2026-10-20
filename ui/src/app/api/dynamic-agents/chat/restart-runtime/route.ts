/** Reconnect a managed agent's cached runtime without changing its session state. */
import { ApiError } from "@/lib/api-middleware";
import { authenticateRequest, getDynamicAgentsConfig, proxyRequest } from "@/lib/da-proxy";
import { authorizeNativeConversationOperation } from "@/lib/harness-conversation-operation";
import { requireAgentPermission } from "@/lib/rbac/resource-authz";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  let body: { agent_id: string; conversation_id: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }
  if (!body.agent_id || !body.conversation_id) {
    return NextResponse.json(
      { success: false, error: "Missing required fields: agent_id, conversation_id" },
      { status: 400 },
    );
  }

  try {
    await requireAgentPermission({
      sub: auth.subject,
      user: { email: auth.email },
      role: auth.role,
      isServiceAccount: auth.isServiceAccount,
    }, body.agent_id, "manage");
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({
      success: false, error: error.message, code: error.code,
      reason: error.reason, action: error.action,
    }, { status: error.statusCode });
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const authorized = await authorizeNativeConversationOperation(
    auth, body.conversation_id, body.agent_id, "runtime restart", true,
  );
  if (authorized instanceof NextResponse) return authorized;
  const config = getDynamicAgentsConfig();
  if (config instanceof NextResponse) return config;
  return proxyRequest(
    `${config.dynamicAgentsUrl}/api/v1/chat/restart-runtime`,
    "POST", auth, "[restart-runtime]",
    JSON.stringify({ ...body, conversation_id: authorized.runtimeId }),
  );
}
