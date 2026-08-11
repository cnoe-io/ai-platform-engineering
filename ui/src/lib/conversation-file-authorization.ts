import { NextRequest, NextResponse } from "next/server";

import { ApiError } from "@/lib/api-middleware";
import {
  authenticateRequest,
  type AuthResult,
} from "@/lib/da-proxy";
import { getCollection } from "@/lib/mongodb";
import { requireConversationResourcePermission } from "@/lib/rbac/conversation-implicit-authz";
import type { ResourcePermissionAction } from "@/lib/rbac/resource-authz";
import type { Conversation } from "@/types/mongodb";

export interface ConversationFileAuthorization {
  agentId: string;
  authResult: AuthResult;
}

export async function authorizeConversationFileRequest(
  request: NextRequest,
  conversationId: string,
  action: ResourcePermissionAction,
): Promise<ConversationFileAuthorization | NextResponse> {
  const authResult = await authenticateRequest(request, {
    resource: "dynamic_agent",
    scope: "invoke",
  });
  if (authResult instanceof NextResponse) return authResult;

  if (!authResult.authzSession || !authResult.email) {
    throw new ApiError("Authenticated user context is required", 401, "NOT_SIGNED_IN");
  }

  const conversations = await getCollection<Conversation>("conversations");
  const conversation = await conversations.findOne({ _id: conversationId });
  if (!conversation) {
    throw new ApiError("Conversation not found", 404, "NOT_FOUND");
  }

  await requireConversationResourcePermission(
    authResult.authzSession,
    authResult.email,
    conversation,
    action,
  );

  const agentId = conversation.participants?.find(
    (participant) => participant.type === "agent",
  )?.id;
  if (!agentId) {
    throw new ApiError(
      "Conversation does not have an agent participant",
      409,
      "CONVERSATION_AGENT_MISSING",
    );
  }

  return { agentId, authResult };
}
