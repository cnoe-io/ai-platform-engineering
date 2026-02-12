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

    // ═══════════════════════════════════════════════════════════════
    // OVERVIEW STATS (parallel queries for speed)
    // ═══════════════════════════════════════════════════════════════
    const [
      totalUsers,
      totalConversations,
      totalMessages,
      dau,
      mau,
      conversationsToday,
      messagesToday,
      sharedConversations,
    ] = await Promise.all([
      users.countDocuments({}),
      conversations.countDocuments({}),
      messages.countDocuments({}),
      users.countDocuments({ last_login: { $gte: today } }),
      users.countDocuments({ last_login: { $gte: thisMonth } }),
      conversations.countDocuments({ created_at: { $gte: today } }),
      messages.countDocuments({ created_at: { $gte: today } }),
      conversations.countDocuments({
        $or: [
          { 'sharing.is_public': true },
          { 'sharing.shared_with.0': { $exists: true } },
          { 'sharing.share_link_enabled': true },
        ],
      }),
    ]);

    // ═══════════════════════════════════════════════════════════════
    // DAILY ACTIVITY — single aggregation per collection instead of
    // 30 sequential countDocuments queries (90 round-trips → 3)
    // ═══════════════════════════════════════════════════════════════
    const dailyUserActivity = await users.aggregate([
      { $match: { last_login: { $gte: last30Days } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$last_login' } },
          active_users: { $sum: 1 },
        },
      },
    ]).toArray();

    const dailyConvActivity = await conversations.aggregate([
      { $match: { created_at: { $gte: last30Days } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          conversations: { $sum: 1 },
        },
      },
    ]).toArray();

    const dailyMsgActivity = await messages.aggregate([
      { $match: { created_at: { $gte: last30Days } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          messages: { $sum: 1 },
        },
      },
    ]).toArray();

    // Build lookup maps
    const userMap = new Map(dailyUserActivity.map((d) => [d._id, d.active_users]));
    const convMap = new Map(dailyConvActivity.map((d) => [d._id, d.conversations]));
    const msgMap = new Map(dailyMsgActivity.map((d) => [d._id, d.messages]));

    // Assemble 30-day array
    const dailyActivity = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dayStart.setHours(0, 0, 0, 0);
      const dateKey = dayStart.toISOString().split('T')[0];
      dailyActivity.push({
        date: dateKey,
        active_users: userMap.get(dateKey) || 0,
        conversations: convMap.get(dateKey) || 0,
        messages: msgMap.get(dateKey) || 0,
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // TOP USERS
    // ═══════════════════════════════════════════════════════════════

    // Top users by conversation count (direct — conversations have owner_id)
    const topUsersByConversations = await conversations.aggregate([
      { $group: { _id: '$owner_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray();

    // Top users by message count — $lookup through conversations for old
    // messages that lack owner_id, $coalesce with direct owner_id for new ones.
    const topUsersByMessages = await messages.aggregate([
      {
        $lookup: {
          from: 'conversations',
          localField: 'conversation_id',
          foreignField: '_id',
          as: '_conv',
        },
      },
      {
        $addFields: {
          _owner: {
            $ifNull: ['$owner_id', { $arrayElemAt: ['$_conv.owner_id', 0] }],
          },
        },
      },
      { $match: { _owner: { $ne: null } } },
      { $group: { _id: '$_owner', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray();

    // ═══════════════════════════════════════════════════════════════
    // ENHANCED ANALYTICS
    // ═══════════════════════════════════════════════════════════════

    // Top agents by usage (from metadata.agent_name on assistant messages)
    const topAgents = await messages.aggregate([
      {
        $match: {
          role: 'assistant',
          'metadata.agent_name': { $exists: true, $ne: null },
        },
      },
      { $group: { _id: '$metadata.agent_name', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray();

    // Feedback summary (positive vs negative across all messages)
    const feedbackAgg = await messages.aggregate([
      { $match: { 'feedback.rating': { $exists: true } } },
      { $group: { _id: '$feedback.rating', count: { $sum: 1 } } },
    ]).toArray();

    const feedbackMap = new Map(feedbackAgg.map((f) => [f._id, f.count]));
    const feedbackSummary = {
      positive: feedbackMap.get('positive') || 0,
      negative: feedbackMap.get('negative') || 0,
      total: (feedbackMap.get('positive') || 0) + (feedbackMap.get('negative') || 0),
    };

    // Average messages per conversation
    const avgMsgsPerConv = totalConversations > 0
      ? Math.round((totalMessages / totalConversations) * 10) / 10
      : 0;

    // Average response time (from metadata.latency_ms on assistant messages)
    const latencyAgg = await messages.aggregate([
      {
        $match: {
          role: 'assistant',
          'metadata.latency_ms': { $exists: true, $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          avg_latency: { $avg: '$metadata.latency_ms' },
          min_latency: { $min: '$metadata.latency_ms' },
          max_latency: { $max: '$metadata.latency_ms' },
          count: { $sum: 1 },
        },
      },
    ]).toArray();

    const responseTime = latencyAgg[0]
      ? {
          avg_ms: Math.round(latencyAgg[0].avg_latency),
          min_ms: latencyAgg[0].min_latency,
          max_ms: latencyAgg[0].max_latency,
          sample_count: latencyAgg[0].count,
        }
      : { avg_ms: 0, min_ms: 0, max_ms: 0, sample_count: 0 };

    // Completed workflows — conversations with at least one is_final assistant msg
    const completedWorkflows = await messages.aggregate([
      {
        $match: {
          role: 'assistant',
          'metadata.is_final': true,
        },
      },
      { $group: { _id: '$conversation_id' } },
      { $count: 'total' },
    ]).toArray();

    const completedToday = await messages.aggregate([
      {
        $match: {
          role: 'assistant',
          'metadata.is_final': true,
          created_at: { $gte: today },
        },
      },
      { $group: { _id: '$conversation_id' } },
      { $count: 'total' },
    ]).toArray();

    // Interrupted/incomplete — conversations that have assistant messages but none with is_final
    const conversationsWithAssistant = await messages.aggregate([
      { $match: { role: 'assistant' } },
      {
        $group: {
          _id: '$conversation_id',
          has_final: { $max: { $cond: [{ $eq: ['$metadata.is_final', true] }, 1, 0] } },
          last_msg_at: { $max: '$created_at' },
          msg_count: { $sum: 1 },
        },
      },
      { $sort: { last_msg_at: -1 } },
    ]).toArray();

    const completedCount = completedWorkflows[0]?.total || 0;
    const completedTodayCount = completedToday[0]?.total || 0;
    const totalWithAssistant = conversationsWithAssistant.length;
    const interruptedCount = conversationsWithAssistant.filter((c) => c.has_final === 0).length;
    const completionRate = totalWithAssistant > 0
      ? Math.round((completedCount / totalWithAssistant) * 1000) / 10
      : 0;

    // Average messages per completed workflow
    const completedConvIds = conversationsWithAssistant
      .filter((c) => c.has_final === 1)
      .map((c) => c._id);
    const avgMsgsCompleted = completedConvIds.length > 0
      ? Math.round(
          (conversationsWithAssistant
            .filter((c) => c.has_final === 1)
            .reduce((sum, c) => sum + c.msg_count, 0) /
            completedConvIds.length) *
            10
        ) / 10
      : 0;

    // Hourly activity heatmap (hour-of-day distribution over last 30 days)
    const hourlyActivity = await messages.aggregate([
      { $match: { created_at: { $gte: last30Days } } },
      {
        $group: {
          _id: { $hour: '$created_at' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray();

    // Fill in missing hours with 0
    const hourlyHeatmap = Array.from({ length: 24 }, (_, hour) => {
      const match = hourlyActivity.find((h) => h._id === hour);
      return { hour, count: match?.count || 0 };
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
        avg_messages_per_conversation: avgMsgsPerConv,
      },
      daily_activity: dailyActivity,
      top_users: {
        by_conversations: topUsersByConversations,
        by_messages: topUsersByMessages,
      },
      top_agents: topAgents,
      feedback_summary: feedbackSummary,
      response_time: responseTime,
      hourly_heatmap: hourlyHeatmap,
      completed_workflows: {
        total: completedCount,
        today: completedTodayCount,
        interrupted: interruptedCount,
        completion_rate: completionRate,
        avg_messages_per_workflow: avgMsgsCompleted,
      },
    });
  });
});
