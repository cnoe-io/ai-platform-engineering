// PUT /api/chat/messages/[id] - Update message (feedback, content, metadata, events)
// [id] can be either a MongoDB ObjectId or a client-generated message_id (UUID)

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
  context: { params: Promise<{ id: string }> }
) => {
  return withAuth(request, async (req, user) => {
    const params = await context.params;
    const messageId = params.id;
    const body: UpdateMessageRequest = await request.json();

    const messages = await getCollection<Message>('messages');

    // Look up by MongoDB _id first, then fall back to client-generated message_id.
    // This allows the chat store to update messages using the UUID it generated.
    let filter: any;
    if (ObjectId.isValid(messageId)) {
      filter = { _id: new ObjectId(messageId) };
    } else {
      filter = { message_id: messageId };
    }

    const message = await messages.findOne(filter);

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

    if (body.content !== undefined) {
      update.content = body.content;
    }

    if (body.metadata) {
      // Merge metadata fields (don't overwrite the whole metadata object)
      if (body.metadata.is_final !== undefined) {
        update['metadata.is_final'] = body.metadata.is_final;
      }
      if (body.metadata.is_interrupted !== undefined) {
        update['metadata.is_interrupted'] = body.metadata.is_interrupted;
      }
      if (body.metadata.task_id !== undefined) {
        update['metadata.task_id'] = body.metadata.task_id;
      }
    }

    if (body.a2a_events !== undefined) {
      update.a2a_events = body.a2a_events;
    }

    if (Object.keys(update).length === 0) {
      return successResponse(message);
    }

    await messages.updateOne(filter, { $set: update });

    const updated = await messages.findOne(filter);

    return successResponse(updated);
  });
});
