// GET /api/chat/conversations/[id]/messages - Get all messages in conversation
// POST /api/chat/conversations/[id]/messages - Add message to conversation

import { NextRequest } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  paginatedResponse,
  ApiError,
  requireConversationAccess,
  validateUUID,
  validateRequired,
  getPaginationParams,
} from '@/lib/api-middleware';
import type { Message, AddMessageRequest, Conversation } from '@/types/mongodb';

// GET /api/chat/conversations/[id]/messages
export const GET = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  return withAuth(request, async (req, user) => {
    const params = await context.params;
    const conversationId = params.id;

    if (!validateUUID(conversationId)) {
      throw new ApiError('Invalid conversation ID format', 400);
    }

    // Verify user has access
    await requireConversationAccess(conversationId, user.email, getCollection);

    const { page, pageSize, skip } = getPaginationParams(request);

    const messages = await getCollection<Message>('messages');

    const total = await messages.countDocuments({ conversation_id: conversationId });

    const items = await messages
      .find({ conversation_id: conversationId })
      .sort({ created_at: 1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();

    return paginatedResponse(items, total, page, pageSize);
  });
});

// POST /api/chat/conversations/[id]/messages
// Uses UPSERT on message_id: if a message with this client-generated ID already
// exists, it is updated (content, metadata, events). This lets the UI call
// saveMessagesToServer idempotently — mid-stream periodic saves and the final
// save all go through the same code path without duplicating rows.
export const POST = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  return withAuth(request, async (req, user) => {
    const params = await context.params;
    const conversationId = params.id;
    const body: AddMessageRequest = await request.json();

    if (!validateUUID(conversationId)) {
      throw new ApiError('Invalid conversation ID format', 400);
    }

    validateRequired(body, ['role', 'content']);

    // Verify user has access and get conversation for owner_id
    await requireConversationAccess(conversationId, user.email, getCollection);

    const conversations = await getCollection<Conversation>('conversations');
    const conversation = await conversations.findOne({ _id: conversationId });
    const ownerId = conversation?.owner_id || user.email;

    const messages = await getCollection<Message>('messages');

    const now = new Date();

    // Upsert: update if message_id exists, insert otherwise.
    // $set updates content/metadata/events on every call (idempotent).
    // $setOnInsert sets immutable fields only on first insert.
    const result = await messages.updateOne(
      { message_id: body.message_id, conversation_id: conversationId },
      {
        $set: {
          content: body.content,
          metadata: {
            turn_id: body.metadata?.turn_id || `turn-${Date.now()}`,
            model: body.metadata?.model,
            tokens_used: body.metadata?.tokens_used,
            latency_ms: body.metadata?.latency_ms,
            agent_name: body.metadata?.agent_name,
            is_final: body.metadata?.is_final,
          },
          ...(body.a2a_events !== undefined && { a2a_events: body.a2a_events }),
          ...(body.artifacts !== undefined && { artifacts: body.artifacts }),
          updated_at: now,
        },
        $setOnInsert: {
          message_id: body.message_id,
          conversation_id: conversationId,
          owner_id: ownerId,
          role: body.role,
          created_at: now,
        },
      },
      { upsert: true }
    );

    // Only increment total_messages on new inserts (not updates)
    if (result.upsertedId) {
      await conversations.updateOne(
        { _id: conversationId },
        {
          $set: { updated_at: now },
          $inc: { 'metadata.total_messages': 1 },
        }
      );
    } else {
      // Just update timestamp for updates
      await conversations.updateOne(
        { _id: conversationId },
        { $set: { updated_at: now } }
      );
    }

    const upserted = await messages.findOne(
      { message_id: body.message_id, conversation_id: conversationId }
    );

    return successResponse(upserted, result.upsertedId ? 201 : 200);
  });
});
