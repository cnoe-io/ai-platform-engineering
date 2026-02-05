// GET /api/chat/search - Search conversations by query and tags

import { NextRequest } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  paginatedResponse,
  getPaginationParams,
} from '@/lib/api-middleware';
import type { Conversation } from '@/types/mongodb';

// GET /api/chat/search
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const tagsParam = url.searchParams.get('tags');
    const tags = tagsParam ? tagsParam.split(',') : [];

    const { page, pageSize, skip } = getPaginationParams(request);

    const conversations = await getCollection<Conversation>('conversations');

    // Build search query
    const searchQuery: any = {
      $or: [
        { owner_id: user.email },
        { 'sharing.shared_with': user.email },
      ],
    };

    // Add text search if query provided
    if (query) {
      searchQuery.$and = searchQuery.$and || [];
      searchQuery.$and.push({
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { tags: { $regex: query, $options: 'i' } },
        ],
      });
    }

    // Add tag filter if tags provided
    if (tags.length > 0) {
      searchQuery.$and = searchQuery.$and || [];
      searchQuery.$and.push({
        tags: { $in: tags },
      });
    }

    const total = await conversations.countDocuments(searchQuery);

    const items = await conversations
      .find(searchQuery)
      .sort({ updated_at: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();

    return paginatedResponse(items, total, page, pageSize);
  });
});
