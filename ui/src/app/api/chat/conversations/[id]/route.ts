// GET /api/chat/conversations/[id] - Get conversation details
// PUT /api/chat/conversations/[id] - Update conversation
// DELETE /api/chat/conversations/[id] - Delete conversation

import { NextRequest } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  requireConversationAccess,
  requireOwnership,
  validateUUID,
} from '@/lib/api-middleware';
import type { Conversation, UpdateConversationRequest } from '@/types/mongodb';

// GET /api/chat/conversations/[id]
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

    const conversation = await requireConversationAccess(
      conversationId,
      user.email,
      getCollection
    );

    return successResponse(conversation);
  });
});

// PUT /api/chat/conversations/[id]
export const PUT = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  return withAuth(request, async (req, user) => {
    const params = await context.params;
    const conversationId = params.id;
    const body: UpdateConversationRequest = await request.json();

    if (!validateUUID(conversationId)) {
      throw new ApiError('Invalid conversation ID format', 400);
    }

    const conversations = await getCollection<Conversation>('conversations');
    const conversation = await conversations.findOne({ _id: conversationId });

    if (!conversation) {
      throw new ApiError('Conversation not found', 404);
    }

    // Only owner can update conversation
    requireOwnership(conversation.owner_id, user.email);

    // Build update
    const update: any = {
      updated_at: new Date(),
    };

    if (body.title !== undefined) update.title = body.title;
    if (body.tags !== undefined) update.tags = body.tags;
    if (body.is_archived !== undefined) update.is_archived = body.is_archived;
    if (body.is_pinned !== undefined) update.is_pinned = body.is_pinned;

    await conversations.updateOne(
      { _id: conversationId },
      { $set: update }
    );

    const updated = await conversations.findOne({ _id: conversationId });

    return successResponse(updated);
  });
});

// DELETE /api/chat/conversations/[id]
export const DELETE = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  return withAuth(request, async (req, user) => {
    const params = await context.params;
    const conversationId = params.id;

    if (!validateUUID(conversationId)) {
      throw new ApiError('Invalid conversation ID format', 400);
    }

    const conversations = await getCollection<Conversation>('conversations');
    const conversation = await conversations.findOne({ _id: conversationId });

    if (!conversation) {
      throw new ApiError('Conversation not found', 404);
    }

    // Only owner can delete conversation
    requireOwnership(conversation.owner_id, user.email);

    // Delete conversation and all its messages
    await conversations.deleteOne({ _id: conversationId });

    const messages = await getCollection('messages');
    await messages.deleteMany({ conversation_id: conversationId });

    return successResponse({ deleted: true });
  });
});
