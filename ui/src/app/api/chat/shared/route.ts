// GET /api/chat/shared - Get conversations shared with current user

import {
getPaginationParams,
paginatedResponse,
withAuth,
withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection } from '@/lib/mongodb';
import { filterConversationsByImplicitOrExplicitPermission } from '@/lib/rbac/conversation-implicit-authz';
import type { Conversation } from '@/types/mongodb';
import { NextRequest } from 'next/server';

// GET /api/chat/shared
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user, session) => {
    const { page, pageSize, skip } = getPaginationParams(request);

    const conversations = await getCollection<Conversation>('conversations');

    // Pre-filter to conversations that carry some sharing configuration.
    // This prevents private conversations from other users from leaking into
    // the OpenFGA permission pipeline and from inflating the total count.
    // OpenFGA / filterConversationsByImplicitOrExplicitPermission remains the
    // authoritative check — it runs after this pre-filter.
    const query = {
      owner_id: { $ne: user.email },
      $or: [
        { 'sharing.is_public': true },
        { 'sharing.shared_with': user.email },
        { 'sharing.share_link_enabled': true },
        // Array has at least one element — user's team membership is checked by OpenFGA below
        { 'sharing.shared_with_teams.0': { $exists: true } },
      ],
    };

    const total = await conversations.countDocuments(query);

    const items = await conversations
      .find(query)
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
