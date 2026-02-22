// GET /api/chat/shared - Get conversations shared with current user

import { NextRequest } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  paginatedResponse,
  getPaginationParams,
  getUserTeamIds,
} from '@/lib/api-middleware';
import type { Conversation } from '@/types/mongodb';

// GET /api/chat/shared
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const { page, pageSize, skip } = getPaginationParams(request);

    const conversations = await getCollection<Conversation>('conversations');

    // Resolve user's team memberships for team-shared conversations
    const userTeamIds = await getUserTeamIds(user.email);

    // Find conversations shared with user directly or via teams (not owned by user)
    const sharedConditions: any[] = [
      { 'sharing.shared_with': user.email },
    ];

    if (userTeamIds.length > 0) {
      sharedConditions.push({
        'sharing.shared_with_teams': { $in: userTeamIds },
      });
    }

    const query = {
      owner_id: { $ne: user.email },
      $or: sharedConditions,
    };

    const total = await conversations.countDocuments(query);

    const items = await conversations
      .find(query)
      .sort({ updated_at: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();

    return paginatedResponse(items, total, page, pageSize);
  });
});
