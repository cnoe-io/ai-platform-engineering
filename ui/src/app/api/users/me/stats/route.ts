// GET /api/users/me/stats - Get user usage statistics

import { NextRequest } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
} from '@/lib/api-middleware';
import type { Conversation, Message, UserStats } from '@/types/mongodb';

// GET /api/users/me/stats
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const conversations = await getCollection<Conversation>('conversations');
    const messages = await getCollection<Message>('messages');

    // Get conversation IDs for user
    const userConversations = await conversations
      .find({ owner_id: user.email })
      .toArray();

    const conversationIds = userConversations.map((c) => c._id);

    // Total conversations
    const totalConversations = await conversations.countDocuments({
      owner_id: user.email,
    });

    // Total messages
    const totalMessages = await messages.countDocuments({
      conversation_id: { $in: conversationIds },
    });

    // Calculate total tokens
    const messageStats = await messages
      .aggregate([
        { $match: { conversation_id: { $in: conversationIds } } },
        {
          $group: {
            _id: null,
            total_tokens: { $sum: '$metadata.tokens_used' },
          },
        },
      ])
      .toArray();

    const totalTokens = messageStats[0]?.total_tokens || 0;

    // This week stats
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const conversationsThisWeek = await conversations.countDocuments({
      owner_id: user.email,
      created_at: { $gte: oneWeekAgo },
    });

    const messagesThisWeek = await messages.countDocuments({
      conversation_id: { $in: conversationIds },
      created_at: { $gte: oneWeekAgo },
    });

    // Favorite agents
    const agentStats = await messages
      .aggregate([
        {
          $match: {
            conversation_id: { $in: conversationIds },
            role: 'assistant',
            'metadata.agent_name': { $exists: true },
          },
        },
        {
          $group: {
            _id: '$metadata.agent_name',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ])
      .toArray();

    const favoriteAgents = agentStats.map((a) => ({
      name: a._id,
      count: a.count,
    }));

    const stats: UserStats = {
      total_conversations: totalConversations,
      total_messages: totalMessages,
      total_tokens_used: totalTokens,
      conversations_this_week: conversationsThisWeek,
      messages_this_week: messagesThisWeek,
      favorite_agents: favoriteAgents,
    };

    return successResponse(stats);
  });
});
