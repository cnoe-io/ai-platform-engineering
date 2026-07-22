// GET /api/users/debug - Debug endpoint to list all users in MongoDB

import {
successResponse,
withAuth,
withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection } from '@/lib/mongodb';
import type { User } from '@/types/mongodb';
import { NextRequest } from 'next/server';

// GET /api/users/debug
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async () => {
    const users = await getCollection<User>('users');

    // Get all users
    const allUsers = await users.find({}).toArray();

    return successResponse({
      total_users: allUsers.length,
      users: allUsers.map(u => ({
        email: u.email,
        name: u.name,
        created_at: u.created_at,
        last_login: u.last_login,
      })),
    });
  });
});
