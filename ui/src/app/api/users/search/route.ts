// GET /api/users/search - Search users by email (for sharing)

import { NextRequest } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from '@/lib/api-middleware';
import type { User, UserPublicInfo } from '@/types/mongodb';

// GET /api/users/search
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q');

    if (!query || query.length < 2) {
      throw new ApiError('Search query must be at least 2 characters', 400);
    }

    const users = await getCollection<User>('users');

    // Search by email or name (case insensitive)
    const results = await users
      .find({
        $or: [
          { email: { $regex: query, $options: 'i' } },
          { name: { $regex: query, $options: 'i' } },
        ],
      })
      .limit(10)
      .toArray();

    // Return only public info
    const publicResults: UserPublicInfo[] = results.map((u) => ({
      email: u.email,
      name: u.name,
      avatar_url: u.avatar_url,
    }));

    return successResponse(publicResults);
  });
});
