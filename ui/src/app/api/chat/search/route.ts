// GET /api/chat/search - Search conversations by query and tags

import {
getPaginationParams,
paginatedResponse,
withAuth,
withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection } from '@/lib/mongodb';
import {
  conversationVisibilityCandidateQuery,
  filterConversationsByImplicitOrExplicitPermission,
} from '@/lib/rbac/conversation-implicit-authz';
import type { Conversation } from '@/types/mongodb';
import { NextRequest } from 'next/server';

// GET /api/chat/search
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user, session) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const tagsParam = url.searchParams.get('tags');
    const tags = tagsParam ? tagsParam.split(',') : [];

    const { page, pageSize, skip } = getPaginationParams(request);

    const conversations = await getCollection<Conversation>('conversations');

    // Build search query from content filters and privacy-safe conversation candidates.
    const searchQuery: any = { $and: [conversationVisibilityCandidateQuery(user.email)] };

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

    const visibleItems = await filterConversationsByImplicitOrExplicitPermission(session, user.email, items);

    return paginatedResponse(
      visibleItems,
      visibleItems.length < items.length ? visibleItems.length : total,
      page,
      pageSize
    );
  });
});
