// GET /api/admin/users/[email] - Get detailed user profile with activity

import { NextRequest } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  errorResponse,
  requireAdminView,
} from '@/lib/api-middleware';
import type { User } from '@/types/mongodb';

export const GET = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ email: string }> }
) => {
  if (!isMongoDBConfigured) {
    return errorResponse('MongoDB not configured', 503, 'MONGODB_NOT_CONFIGURED');
  }

  return withAuth(request, async (req, _user, session) => {
    requireAdminView(session);

    const { email } = await context.params;
    const decodedEmail = decodeURIComponent(email);

    const users = await getCollection<User>('users');
    const conversations = await getCollection('conversations');
    const feedbackColl = await getCollection('feedback');

    const user = await users.findOne({ email: decodedEmail });
    if (!user) {
      return errorResponse('User not found', 404, 'USER_NOT_FOUND');
    }

    // Fetch in parallel: conversations, feedback stats, recent feedback
    const [
      userConversations,
      totalConversations,
      feedbackStats,
      recentFeedback,
    ] = await Promise.all([
      // Recent conversations (latest 20)
      conversations
        .find(
          { owner_id: decodedEmail },
          { projection: { _id: 1, title: 1, source: 1, channel_id: 1, channel_name: 1, created_at: 1, updated_at: 1 } }
        )
        .sort({ updated_at: -1 })
        .limit(20)
        .toArray(),

      // Total conversation count
      conversations.countDocuments({ owner_id: decodedEmail }),

      // Feedback breakdown
      feedbackColl.aggregate([
        { $match: { user_email: decodedEmail } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            positive: { $sum: { $cond: [{ $eq: ['$rating', 'positive'] }, 1, 0] } },
            negative: { $sum: { $cond: [{ $eq: ['$rating', 'negative'] }, 1, 0] } },
          },
        },
      ]).toArray(),

      // Recent feedback (latest 10)
      feedbackColl
        .find(
          { user_email: decodedEmail },
          { projection: { _id: 0, source: 1, rating: 1, value: 1, comment: 1, channel_name: 1, created_at: 1, conversation_id: 1, slack_permalink: 1 } }
        )
        .sort({ created_at: -1 })
        .limit(10)
        .toArray(),
    ]);

    const fbStats = feedbackStats[0] || { total: 0, positive: 0, negative: 0 };

    return successResponse({
      profile: {
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url || null,
        role: user.metadata?.role || 'user',
        source: (user as any).source || 'web',
        slack_user_id: (user as any).slack_user_id || null,
        created_at: user.created_at,
        last_login: user.last_login,
      },
      stats: {
        total_conversations: totalConversations,
        feedback_given: fbStats.total,
        feedback_positive: fbStats.positive,
        feedback_negative: fbStats.negative,
      },
      recent_conversations: userConversations.map((c: any) => ({
        id: c._id,
        title: c.title || 'Untitled',
        source: c.source || 'web',
        channel_id: c.channel_id || null,
        channel_name: c.channel_name || null,
        created_at: c.created_at,
        updated_at: c.updated_at,
      })),
      recent_feedback: recentFeedback.map((f: any) => ({
        source: f.source || 'web',
        rating: f.rating,
        value: f.value,
        comment: f.comment || null,
        channel_name: f.channel_name || null,
        conversation_id: f.conversation_id || null,
        slack_permalink: f.slack_permalink || null,
        created_at: f.created_at,
      })),
    });
  });
});
