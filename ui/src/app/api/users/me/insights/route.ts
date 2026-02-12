// GET /api/users/me/insights - Get user prompt insights and usage analytics

import { NextRequest } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
} from '@/lib/api-middleware';
import type { Conversation, Message } from '@/types/mongodb';

// GET /api/users/me/insights
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const conversations = await getCollection<Conversation>('conversations');
    const messages = await getCollection<Message>('messages');

    const now = new Date();
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get all conversation IDs owned by user
    const userConversations = await conversations
      .find({ owner_id: user.email })
      .project({ _id: 1, title: 1, created_at: 1 })
      .toArray();

    const conversationIds = userConversations.map((c) => c._id);
    const convTitleMap = new Map(
      userConversations.map((c) => [c._id, c.title])
    );

    // ═══════════════════════════════════════════════════════════════
    // OVERVIEW STATS
    // ═══════════════════════════════════════════════════════════════
    const [totalConversations, totalMessages, conversationsThisWeek, messagesThisWeek] =
      await Promise.all([
        conversations.countDocuments({ owner_id: user.email }),
        messages.countDocuments({ conversation_id: { $in: conversationIds } }),
        conversations.countDocuments({
          owner_id: user.email,
          created_at: { $gte: oneWeekAgo },
        }),
        messages.countDocuments({
          conversation_id: { $in: conversationIds },
          created_at: { $gte: oneWeekAgo },
        }),
      ]);

    // Total tokens
    const tokenAgg = await messages
      .aggregate([
        { $match: { conversation_id: { $in: conversationIds } } },
        {
          $group: {
            _id: null,
            total_tokens: { $sum: { $ifNull: ['$metadata.tokens_used', 0] } },
          },
        },
      ])
      .toArray();
    const totalTokens = tokenAgg[0]?.total_tokens || 0;

    // ═══════════════════════════════════════════════════════════════
    // RECENT PROMPTS (last 20 user messages with conversation titles)
    // ═══════════════════════════════════════════════════════════════
    const recentPrompts = await messages
      .find({
        conversation_id: { $in: conversationIds },
        role: 'user',
      })
      .sort({ created_at: -1 })
      .limit(20)
      .project({
        content: 1,
        conversation_id: 1,
        created_at: 1,
      })
      .toArray();

    const promptHistory = recentPrompts.map((msg) => ({
      content: msg.content.slice(0, 300), // Preview only
      content_length: msg.content.length,
      conversation_id: msg.conversation_id,
      conversation_title: convTitleMap.get(msg.conversation_id) || 'Untitled',
      timestamp: msg.created_at,
    }));

    // ═══════════════════════════════════════════════════════════════
    // USAGE OVER TIME (daily message counts for last 30 days)
    // ═══════════════════════════════════════════════════════════════
    const dailyUsageAgg = await messages
      .aggregate([
        {
          $match: {
            conversation_id: { $in: conversationIds },
            created_at: { $gte: last30Days },
          },
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
              role: '$role',
            },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    // Build lookup maps
    const userMsgMap = new Map<string, number>();
    const assistantMsgMap = new Map<string, number>();
    for (const entry of dailyUsageAgg) {
      const map = entry._id.role === 'user' ? userMsgMap : assistantMsgMap;
      map.set(entry._id.date, (map.get(entry._id.date) || 0) + entry.count);
    }

    const dailyUsage = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      day.setHours(0, 0, 0, 0);
      const dateKey = day.toISOString().split('T')[0];
      dailyUsage.push({
        date: dateKey,
        prompts: userMsgMap.get(dateKey) || 0,
        responses: assistantMsgMap.get(dateKey) || 0,
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // PROMPT PATTERNS
    // ═══════════════════════════════════════════════════════════════
    const promptPatternAgg = await messages
      .aggregate([
        {
          $match: {
            conversation_id: { $in: conversationIds },
            role: 'user',
          },
        },
        {
          $group: {
            _id: null,
            avg_length: { $avg: { $strLenCP: '$content' } },
            max_length: { $max: { $strLenCP: '$content' } },
            total_prompts: { $sum: 1 },
          },
        },
      ])
      .toArray();

    // Most active hour and day of week
    const hourAgg = await messages
      .aggregate([
        {
          $match: {
            conversation_id: { $in: conversationIds },
            role: 'user',
            created_at: { $gte: last30Days },
          },
        },
        {
          $group: {
            _id: { $hour: '$created_at' },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 1 },
      ])
      .toArray();

    const dayOfWeekAgg = await messages
      .aggregate([
        {
          $match: {
            conversation_id: { $in: conversationIds },
            role: 'user',
            created_at: { $gte: last30Days },
          },
        },
        {
          $group: {
            _id: { $dayOfWeek: '$created_at' },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 1 },
      ])
      .toArray();

    const dayNames = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const promptPatterns = {
      avg_length: Math.round(promptPatternAgg[0]?.avg_length || 0),
      max_length: promptPatternAgg[0]?.max_length || 0,
      total_prompts: promptPatternAgg[0]?.total_prompts || 0,
      peak_hour: hourAgg[0]?._id ?? null,
      peak_hour_label: hourAgg[0] ? `${hourAgg[0]._id}:00 UTC` : 'N/A',
      peak_day: dayOfWeekAgg[0] ? dayNames[dayOfWeekAgg[0]._id] : 'N/A',
    };

    // ═══════════════════════════════════════════════════════════════
    // AGENT USAGE BREAKDOWN
    // ═══════════════════════════════════════════════════════════════
    const agentUsage = await messages
      .aggregate([
        {
          $match: {
            conversation_id: { $in: conversationIds },
            role: 'assistant',
            'metadata.agent_name': { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: '$metadata.agent_name',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray();

    const favoriteAgents = agentUsage.map((a) => ({
      name: a._id,
      count: a.count,
    }));

    // ═══════════════════════════════════════════════════════════════
    // FEEDBACK GIVEN
    // ═══════════════════════════════════════════════════════════════
    const feedbackAgg = await messages
      .aggregate([
        {
          $match: {
            conversation_id: { $in: conversationIds },
            'feedback.rating': { $exists: true },
          },
        },
        {
          $group: {
            _id: '$feedback.rating',
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const feedbackMap = new Map(feedbackAgg.map((f) => [f._id, f.count]));
    const feedbackGiven = {
      positive: feedbackMap.get('positive') || 0,
      negative: feedbackMap.get('negative') || 0,
      total: (feedbackMap.get('positive') || 0) + (feedbackMap.get('negative') || 0),
    };

    // ═══════════════════════════════════════════════════════════════
    // SESSION STATS
    // ═══════════════════════════════════════════════════════════════
    const convMsgCounts = await messages
      .aggregate([
        { $match: { conversation_id: { $in: conversationIds } } },
        {
          $group: {
            _id: '$conversation_id',
            message_count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const avgMessagesPerConversation =
      convMsgCounts.length > 0
        ? Math.round(
            (convMsgCounts.reduce((sum, c) => sum + c.message_count, 0) /
              convMsgCounts.length) *
              10
          ) / 10
        : 0;

    return successResponse({
      overview: {
        total_conversations: totalConversations,
        total_messages: totalMessages,
        total_tokens_used: totalTokens,
        conversations_this_week: conversationsThisWeek,
        messages_this_week: messagesThisWeek,
        avg_messages_per_conversation: avgMessagesPerConversation,
      },
      recent_prompts: promptHistory,
      daily_usage: dailyUsage,
      prompt_patterns: promptPatterns,
      favorite_agents: favoriteAgents,
      feedback_given: feedbackGiven,
    });
  });
});
