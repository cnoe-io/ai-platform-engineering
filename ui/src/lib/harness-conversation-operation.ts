import { NextResponse } from "next/server";

import {
  authorizeConversationReadAccess,
  authorizeConversationWriteAccess,
  resolveConversationRuntimeId,
} from "@/app/api/v1/chat/_conversation-authz";
import type { AuthResult } from "@/lib/da-proxy";
import { resolveHarnessGatewayTarget } from "@/lib/harness-gateway";
import { requireAgentUsePermission } from "@/lib/rbac/openfga-agent-authz";

/** Check the selected owner before an operation that only the native adapter implements. */
export async function requireNativeHarnessOperation(
  agentId: string,
  runtimeId: string,
  operation: string,
): Promise<NextResponse | null> {
  const target = await resolveHarnessGatewayTarget(agentId, { conversationId: runtimeId });
  if (target instanceof NextResponse) return target;
  if (target.kind === "dynamic_agents") return null;
  return NextResponse.json({
    success: false,
    code: "HARNESS_CAPABILITY_UNSUPPORTED",
    error: `This agent's runtime does not support ${operation}.`,
  }, { status: 501 });
}

/** Preserve conversation and agent authorization before inspecting a runtime binding. */
export async function authorizeNativeConversationOperation(
  auth: AuthResult,
  conversationId: string,
  agentId: string,
  operation: string,
  write = false,
): Promise<{ runtimeId: string } | NextResponse> {
  const agentDenial = await requireAgentUsePermission({
    subject: auth.subject,
    agentId,
    email: auth.email,
    tenantId: auth.tenantId,
    isServiceAccount: auth.isServiceAccount,
  });
  if (agentDenial) return agentDenial;
  const access = write
    ? await authorizeConversationWriteAccess(auth, conversationId)
    : await authorizeConversationReadAccess(auth, conversationId, agentId);
  if (access.denial) return access.denial;
  if (access.conversation.participants?.find((participant) => participant.type === "agent")?.id !== agentId) {
    return NextResponse.json({ success: false, error: "Agent does not match this conversation" }, { status: 403 });
  }
  const runtimeId = await resolveConversationRuntimeId(access.conversation);
  const unsupported = await requireNativeHarnessOperation(agentId, runtimeId, operation);
  return unsupported ?? { runtimeId };
}
