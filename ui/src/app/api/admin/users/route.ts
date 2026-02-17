// GET /api/admin/users - Get all users with statistics
// POST /api/admin/users/[id]/role - Update user role

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from '@/lib/api-middleware';
import type { User } from '@/types/mongodb';

// GET /api/admin/users - List all users with their activity stats
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - admin features require MongoDB',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  return withAuth(request, async (req, user, session) => {
    // Check if user is admin (from OIDC group)
    if (session.role !== 'admin') {
      throw new ApiError('Admin access required - must be member of admin group', 403);
    }

    const users = await getCollection<User>('users');
    const conversations = await getCollection('conversations');
    const messages = await getCollection('messages');

    // Get all users
    const allUsers = await users.find({}).sort({ created_at: -1 }).toArray();

    // Get stats for each user
    const usersWithStats = await Promise.all(
      allUsers.map(async (u) => {
        const userConversations = await conversations.countDocuments({ owner_id: u.email });
        const userMessages = await messages.countDocuments({ user_id: u.email });
        
        // Get last activity
        const lastConversation = await conversations
          .findOne({ owner_id: u.email }, { sort: { updated_at: -1 } });
        
        return {
          email: u.email,
          name: u.name,
          role: u.metadata?.role || 'user',
          created_at: u.created_at,
          last_login: u.last_login,
          last_activity: lastConversation?.updated_at || u.last_login,
          stats: {
            conversations: userConversations,
            messages: userMessages,
          },
        };
      })
    );

    return successResponse({
      users: usersWithStats,
      total: usersWithStats.length,
    });
  });
});
