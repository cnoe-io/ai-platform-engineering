// GET /api/admin/stats - Get platform usage statistics

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from '@/lib/api-middleware';

// GET /api/admin/stats
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

    const users = await getCollection('users');
    const conversations = await getCollection('conversations');
    const messages = await getCollection('messages');

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Overall stats
    const totalUsers = await users.countDocuments({});
    const totalConversations = await conversations.countDocuments({});
    const totalMessages = await messages.countDocuments({});

    // Daily Active Users (users with activity today)
    const dau = await users.countDocuments({
      last_login: { $gte: today },
    });

    // Monthly Active Users (users with activity this month)
    const mau = await users.countDocuments({
      last_login: { $gte: thisMonth },
    });

    // Conversations created today
    const conversationsToday = await conversations.countDocuments({
      created_at: { $gte: today },
    });

    // Messages sent today
    const messagesToday = await messages.countDocuments({
      created_at: { $gte: today },
    });

    // Get daily activity for the last 30 days
    const dailyActivity = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const activeUsers = await users.countDocuments({
        last_login: { $gte: dayStart, $lte: dayEnd },
      });

      const conversationsCount = await conversations.countDocuments({
        created_at: { $gte: dayStart, $lte: dayEnd },
      });

      const messagesCount = await messages.countDocuments({
        created_at: { $gte: dayStart, $lte: dayEnd },
      });

      dailyActivity.push({
        date: dayStart.toISOString().split('T')[0],
        active_users: activeUsers,
        conversations: conversationsCount,
        messages: messagesCount,
      });
    }

    // Top users by conversation count
    const topUsersByConversations = await conversations.aggregate([
      { $group: { _id: '$owner_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray();

    // Top users by message count
    const topUsersByMessages = await messages.aggregate([
      { $group: { _id: '$user_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray();

    // Shared conversations count
    const sharedConversations = await conversations.countDocuments({
      $or: [
        { 'sharing.is_public': true },
        { 'sharing.shared_with.0': { $exists: true } },
        { 'sharing.share_link_enabled': true },
      ],
    });

    return successResponse({
      overview: {
        total_users: totalUsers,
        total_conversations: totalConversations,
        total_messages: totalMessages,
        shared_conversations: sharedConversations,
        dau,
        mau,
        conversations_today: conversationsToday,
        messages_today: messagesToday,
      },
      daily_activity: dailyActivity,
      top_users: {
        by_conversations: topUsersByConversations,
        by_messages: topUsersByMessages,
      },
    });
  });
});
