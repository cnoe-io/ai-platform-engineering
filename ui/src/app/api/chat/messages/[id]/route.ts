// PUT /api/chat/messages/[id] - Update message (mainly for feedback)

import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from '@/lib/api-middleware';
import type { Message, UpdateMessageRequest } from '@/types/mongodb';

// PUT /api/chat/messages/[id]
export const PUT = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: { id: string } }
) => {
  return withAuth(request, async (req, user) => {
    const messageId = params.id;
    const body: UpdateMessageRequest = await request.json();

    if (!ObjectId.isValid(messageId)) {
      throw new ApiError('Invalid message ID format', 400);
    }

    const messages = await getCollection<Message>('messages');
    const message = await messages.findOne({ _id: new ObjectId(messageId) });

    if (!message) {
      throw new ApiError('Message not found', 404);
    }

    // Build update
    const update: any = {};

    if (body.feedback) {
      update.feedback = {
        rating: body.feedback.rating,
        comment: body.feedback.comment,
        submitted_at: new Date(),
      };
    }

    await messages.updateOne(
      { _id: new ObjectId(messageId) },
      { $set: update }
    );

    const updated = await messages.findOne({ _id: new ObjectId(messageId) });

    return successResponse(updated);
  });
});
