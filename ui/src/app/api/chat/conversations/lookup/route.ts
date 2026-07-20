/**
 * GET /api/chat/conversations/lookup
 *
 * Resolve an existing conversation by its integration idempotency key without
 * creating one. This is used by stateless integrations that need to recover
 * durable conversation metadata after a process restart.
 */

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { requireConversationResourcePermission } from "@/lib/rbac/conversation-implicit-authz";
import type { ClientType, Conversation } from "@/types/mongodb";
import { VALID_CLIENT_TYPES } from "@/types/mongodb";
import { NextRequest, NextResponse } from "next/server";

const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: "MongoDB not configured",
        code: "MONGODB_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
  const url = new URL(request.url);
  const idempotencyKey = url.searchParams.get("idempotency_key")?.trim() ?? "";
  const clientType = (url.searchParams.get("client_type")?.trim() || "slack") as ClientType;

  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ApiError("A valid idempotency_key is required", 400);
  }
  if (!VALID_CLIENT_TYPES.includes(clientType)) {
    throw new ApiError(`Invalid client_type: "${clientType}"`, 400);
  }

  const conversations = await getCollection<Conversation>("conversations");
  const conversation = await conversations.findOne({
    idempotency_key: idempotencyKey,
    client_type: clientType,
    $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }],
  });

  if (!conversation) {
    throw new ApiError("Conversation not found", 404);
  }

  await requireConversationResourcePermission(session, user.email, conversation, "read");

  return successResponse({
    conversation: {
      _id: conversation._id,
      client_type: conversation.client_type,
      metadata: conversation.metadata ?? {},
    },
  });
});
