// GET /api/chat/bookmarks - Get user's bookmarks
// POST /api/chat/bookmarks - Create bookmark

import { NextRequest } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  paginatedResponse,
  validateRequired,
  validateUUID,
  ApiError,
  getPaginationParams,
} from '@/lib/api-middleware';
import type { ConversationBookmark, CreateBookmarkRequest } from '@/types/mongodb';

// GET /api/chat/bookmarks
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const { page, pageSize, skip } = getPaginationParams(request);

    const bookmarks = await getCollection<ConversationBookmark>('conversation_bookmarks');

    const total = await bookmarks.countDocuments({ user_id: user.email });

    const items = await bookmarks
      .find({ user_id: user.email })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();

    return paginatedResponse(items, total, page, pageSize);
  });
});

// POST /api/chat/bookmarks
export const POST = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const body: CreateBookmarkRequest = await request.json();

    validateRequired(body, ['conversation_id']);

    if (!validateUUID(body.conversation_id)) {
      throw new ApiError('Invalid conversation ID format', 400);
    }

    const bookmarks = await getCollection<ConversationBookmark>('conversation_bookmarks');

    const now = new Date();
    const newBookmark: Omit<ConversationBookmark, '_id'> = {
      user_id: user.email,
      conversation_id: body.conversation_id,
      message_id: body.message_id,
      note: body.note,
      created_at: now,
    };

    const result = await bookmarks.insertOne(newBookmark as ConversationBookmark);
    const created = await bookmarks.findOne({ _id: result.insertedId });

    return successResponse(created, 201);
  });
});
