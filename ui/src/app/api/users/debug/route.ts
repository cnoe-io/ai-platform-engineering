// GET /api/users/debug - Debug endpoint to list all users in MongoDB

import { NextRequest } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
} from '@/lib/api-middleware';
import type { User } from '@/types/mongodb';

// GET /api/users/debug
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
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
