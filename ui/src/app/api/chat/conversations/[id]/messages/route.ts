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

    // Verify user has access
    await requireConversationAccess(conversationId, user.email, getCollection);

    const messages = await getCollection<Message>('messages');

    const now = new Date();
    const newMessage: Omit<Message, '_id'> = {
      conversation_id: conversationId,
      role: body.role,
      content: body.content,
      created_at: now,
      metadata: {
        turn_id: body.metadata?.turn_id || `turn-${Date.now()}`,
        model: body.metadata?.model,
        tokens_used: body.metadata?.tokens_used,
        latency_ms: body.metadata?.latency_ms,
        agent_name: body.metadata?.agent_name,
      },
      artifacts: body.artifacts,
    };

    const result = await messages.insertOne(newMessage as Message);

    // Update conversation metadata
    const conversations = await getCollection<Conversation>('conversations');
    await conversations.updateOne(
      { _id: conversationId },
      {
        $set: { updated_at: now },
        $inc: { 'metadata.total_messages': 1 },
      }
    );

    const created = await messages.findOne({ _id: result.insertedId });

    return successResponse(created, 201);
  });
});
