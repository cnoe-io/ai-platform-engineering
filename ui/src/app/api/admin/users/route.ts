// GET /api/admin/users - List all users with per-user activity statistics

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdminView,
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
    requireAdminView(session);

    const users = await getCollection<User>('users');
    const conversations = await getCollection('conversations');
    const messages = await getCollection('messages');

    // Build set of emails that have a local credentials account
    let localEmails = new Set<string>();
    try {
      const localUsers = await getCollection<{ email: string }>('local_users');
      const localDocs = await localUsers.find({}, { projection: { email: 1 } }).toArray();
      localEmails = new Set(localDocs.map((d) => d.email));
    } catch {
      // local_users may not exist — treat all as SSO
    }

    // Get all users
    const allUsers = await users.find({}).sort({ created_at: -1 }).toArray();

    // Pre-aggregate message counts per user (messages carry owner_id directly).
    const msgCountsByOwner = await messages.aggregate([
      { $match: { owner_id: { $ne: null } } },
      { $group: { _id: '$owner_id', count: { $sum: 1 } } },
    ]).toArray();

    const msgCountMap = new Map(msgCountsByOwner.map((m) => [m._id, m.count]));

    // Get stats for each user
    const usersWithStats = await Promise.all(
      allUsers.map(async (u) => {
        const userConversations = await conversations.countDocuments({ owner_id: u.email });

        // Get last activity
        const lastConversation = await conversations
          .findOne({ owner_id: u.email }, { sort: { updated_at: -1 } });

        // auth_provider: 'local' if they have a credentials account, otherwise
        // the SSO provider stored in metadata (e.g. 'oidc', 'duo', 'github')
        const auth_provider: string = localEmails.has(u.email)
          ? 'local'
          : (u.metadata?.sso_provider || 'sso');

        return {
          email: u.email,
          name: u.name,
          role: u.metadata?.role || 'user',
          auth_provider,
          created_at: u.created_at,
          last_login: u.last_login,
          last_activity: lastConversation?.updated_at || u.last_login,
          stats: {
            conversations: userConversations,
            messages: msgCountMap.get(u.email) || 0,
          },
        };
      })
    );

    return successResponse({
      users: usersWithStats,
      total: usersWithStats.length,
      pagination: {
        page: 1,
        total_pages: usersWithStats.length > 0 ? 1 : 0,
        total: usersWithStats.length,
      },
    });
  });
});
