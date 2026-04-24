// GET /api/admin/stats - Get platform usage statistics

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdminView,
} from '@/lib/api-middleware';

/** Parse range params into a { rangeStart, days } pair. Supports preset strings and explicit from/to ISO dates. */
function parseRange(searchParams: URLSearchParams): { rangeStart: Date; days: number } {
  const now = new Date();
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');

  if (fromParam) {
    const from = new Date(fromParam);
    const to = toParam ? new Date(toParam) : now;
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
    return { rangeStart: from, days };
  }

  const range = searchParams.get('range');
  let ms: number;
  switch (range) {
    case '1h':  ms = 60 * 60 * 1000; break;
    case '12h': ms = 12 * 60 * 60 * 1000; break;
    case '24h':
    case '1d':  ms = 24 * 60 * 60 * 1000; break;
    case '7d':  ms = 7 * 24 * 60 * 60 * 1000; break;
    case '90d': ms = 90 * 24 * 60 * 60 * 1000; break;
    case '30d':
    default:    ms = 30 * 24 * 60 * 60 * 1000; break;
  }
  return { rangeStart: new Date(now.getTime() - ms), days: Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000))) };
}

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
    requireAdminView(session);

    const { searchParams } = new URL(request.url);
    const { rangeStart, days } = parseRange(searchParams);

    // Optional filters
    const sourceFilter = searchParams.get('source'); // 'web' | 'slack' | null (all)
    const userFilter = searchParams.get('user'); // comma-separated emails | null (all)
    const userEmails = userFilter ? userFilter.split(',').map((u) => u.trim()).filter(Boolean) : [];
    const channelFilter = searchParams.get('channel'); // comma-separated channel names (slack only)
    const channelNames = channelFilter ? channelFilter.split(',').map((c) => c.trim()).filter(Boolean) : [];

    // Build reusable filter fragments for conversations and messages.
    // Support both legacy (source/slack_meta) and new (client_type/metadata) schemas.
    const SLACK_CONV_MATCH = { $or: [{ source: 'slack' }, { client_type: 'slack' }] };

    const hasFilters = !!sourceFilter || userEmails.length > 0;
    const convSourceFilter: Record<string, any> = {};
    const msgOwnerFilter: Record<string, any> = {};
    if (sourceFilter === 'web') {
      convSourceFilter.source = { $ne: 'slack' };
      convSourceFilter.client_type = { $ne: 'slack' };
      msgOwnerFilter['metadata.source'] = 'web';
    } else if (sourceFilter === 'slack') {
      Object.assign(convSourceFilter, SLACK_CONV_MATCH);
      msgOwnerFilter['metadata.source'] = 'slack';
      // Channel filter: check both old slack_meta and new metadata paths
      if (channelNames.length > 0) {
        const names = channelNames.length === 1 ? channelNames[0] : { $in: channelNames };
        const channelMatch = { $or: [
          { 'slack_meta.channel_name': names },
          { 'metadata.channel_name': names },
        ]};
        delete convSourceFilter.$or;
        convSourceFilter.$and = [SLACK_CONV_MATCH, channelMatch];
      }
    }
    if (userEmails.length === 1) {
      convSourceFilter.owner_id = userEmails[0];
      msgOwnerFilter.owner_id = userEmails[0];
    } else if (userEmails.length > 1) {
      convSourceFilter.owner_id = { $in: userEmails };
      msgOwnerFilter.owner_id = { $in: userEmails };
    }

    const users = await getCollection('users');
    const conversations = await getCollection('conversations');
    const messages = await getCollection('messages');

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // ═══════════════════════════════════════════════════════════════
    // OVERVIEW STATS (parallel queries for speed)
    // ═══════════════════════════════════════════════════════════════
    const [
      totalUsers,
      totalConversations,
      webTotalMessages,
      slackTotalMessages,
      dau,
      mau,
      conversationsToday,
      webMessagesToday,
      slackMessagesToday,
      sharedConversations,
    ] = await Promise.all([
      users.countDocuments({}),
      conversations.countDocuments({ ...convSourceFilter }),
      sourceFilter !== 'slack'
        ? messages.countDocuments({ 'metadata.source': 'web', ...msgOwnerFilter })
        : Promise.resolve(0),
      sourceFilter !== 'web'
        ? messages.countDocuments({ 'metadata.source': 'slack' })
        : Promise.resolve(0),
      // DAU/MAU: derive from conversations when filters are applied, otherwise from users
      hasFilters
        ? conversations.aggregate([
            { $match: { updated_at: { $gte: today }, ...convSourceFilter } },
            { $group: { _id: '$owner_id' } },
            { $count: 'total' },
          ]).toArray().then((r) => r[0]?.total || 0)
        : users.countDocuments({ last_login: { $gte: today } }),
      hasFilters
        ? conversations.aggregate([
            { $match: { updated_at: { $gte: thisMonth }, ...convSourceFilter } },
            { $group: { _id: '$owner_id' } },
            { $count: 'total' },
          ]).toArray().then((r) => r[0]?.total || 0)
        : users.countDocuments({ last_login: { $gte: thisMonth } }),
      conversations.countDocuments({ created_at: { $gte: today }, ...convSourceFilter }),
      sourceFilter !== 'slack'
        ? messages.countDocuments({ 'metadata.source': 'web', created_at: { $gte: today }, ...msgOwnerFilter })
        : Promise.resolve(0),
      sourceFilter !== 'web'
        ? messages.countDocuments({ 'metadata.source': 'slack', created_at: { $gte: today } })
        : Promise.resolve(0),
      conversations.countDocuments({
        ...convSourceFilter,
        $or: [
          { 'sharing.is_public': true },
          { 'sharing.shared_with.0': { $exists: true } },
          { 'sharing.share_link_enabled': true },
        ],
      }),
    ]);

    const totalMessages = webTotalMessages + slackTotalMessages;
    const messagesToday = webMessagesToday + slackMessagesToday;

    // ═══════════════════════════════════════════════════════════════
    // DAILY ACTIVITY — single aggregation per collection instead of
    // 30 sequential countDocuments queries (90 round-trips → 3)
    // ═══════════════════════════════════════════════════════════════
    // When filters are active, derive active users from conversations instead of users collection
    const dailyUserActivity = hasFilters
      ? await conversations.aggregate([
          { $match: { updated_at: { $gte: rangeStart }, ...convSourceFilter } },
          {
            $group: {
              _id: {
                date: { $dateToString: { format: '%Y-%m-%d', date: '$updated_at' } },
                user: '$owner_id',
              },
            },
          },
          { $group: { _id: '$_id.date', active_users: { $sum: 1 } } },
        ]).toArray()
      : await users.aggregate([
          { $match: { last_login: { $gte: rangeStart } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$last_login' } },
              active_users: { $sum: 1 },
            },
          },
        ]).toArray();

    const dailyConvActivity = await conversations.aggregate([
      { $match: { created_at: { $gte: rangeStart }, ...convSourceFilter } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          conversations: { $sum: 1 },
        },
      },
    ]).toArray();

    // Web messages (from messages collection) + Slack messages (message_count on conversations)
    const [dailyWebMsgActivity, dailySlackMsgActivity] = await Promise.all([
      sourceFilter !== 'slack'
        ? messages.aggregate([
            { $match: { 'metadata.source': 'web', created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
                messages: { $sum: 1 },
              },
            },
          ]).toArray()
        : Promise.resolve([]),
      sourceFilter !== 'web'
        ? messages.aggregate([
            { $match: { 'metadata.source': 'slack', created_at: { $gte: rangeStart } } },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
                messages: { $sum: 1 },
              },
            },
          ]).toArray()
        : Promise.resolve([]),
    ]);

    // Merge web + slack daily message counts
    const msgMap = new Map<string, number>();
    for (const d of dailyWebMsgActivity) msgMap.set(d._id, (msgMap.get(d._id) || 0) + d.messages);
    for (const d of dailySlackMsgActivity) msgMap.set(d._id, (msgMap.get(d._id) || 0) + d.messages);

    // Build lookup maps
    const userMap = new Map(dailyUserActivity.map((d) => [d._id, d.active_users]));
    const convMap = new Map(dailyConvActivity.map((d) => [d._id, d.conversations]));

    // Assemble N-day array
    const dailyActivity = [];
    for (let i = days - 1; i >= 0; i--) {
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
    const rawTopByConvs = await conversations.aggregate([
      { $match: { created_at: { $gte: rangeStart }, ...convSourceFilter } },
      { $group: { _id: '$owner_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray();

    // Top users by message count — $lookup through conversations for old
    // messages that lack owner_id, $coalesce with direct owner_id for new ones.
    const rawTopByMsgs = await messages.aggregate([
      { $match: { created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
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

    // Resolve display names for top user IDs — owner_id may be an email
    // or a raw Slack/bot ID when email resolution failed at interaction time.
    const topOwnerIds = [...new Set([
      ...rawTopByConvs.map((u) => u._id),
      ...rawTopByMsgs.map((u) => u._id),
    ])].filter(Boolean);

    const userDocs = topOwnerIds.length > 0
      ? await users.find(
          { $or: [{ email: { $in: topOwnerIds } }, { slack_user_id: { $in: topOwnerIds } }] },
          { projection: { email: 1, name: 1, slack_user_id: 1 } },
        ).toArray()
      : [];

    const nameByOwner = new Map<string, string>();
    for (const u of userDocs) {
      if (u.email) nameByOwner.set(u.email, u.name || u.email);
      if (u.slack_user_id) nameByOwner.set(u.slack_user_id, u.name || u.email);
    }

    const enrichTopUsers = (raw: typeof rawTopByConvs) =>
      raw.map((u) => ({
        _id: u._id,
        count: u.count,
        name: nameByOwner.get(u._id) || u._id,
      }));

    const topUsersByConversations = enrichTopUsers(rawTopByConvs);
    const topUsersByMessages = enrichTopUsers(rawTopByMsgs);

    // ═══════════════════════════════════════════════════════════════
    // ENHANCED ANALYTICS
    // ═══════════════════════════════════════════════════════════════

    // Top agents by usage (from metadata.agent_name on assistant messages)
    const topAgents = await messages.aggregate([
      {
        $match: {
          role: 'assistant',
          'metadata.agent_name': { $exists: true, $ne: null },
          created_at: { $gte: rangeStart },
          ...msgOwnerFilter,
        },
      },
      { $group: { _id: '$metadata.agent_name', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray();

    // ═══════════════════════════════════════════════════════════════
    // FEEDBACK SUMMARY (from unified feedback collection)
    // ═══════════════════════════════════════════════════════════════
    const feedbackColl = await getCollection('feedback');

    // Build feedback filter
    const fbFilter: Record<string, any> = { created_at: { $gte: rangeStart } };
    if (sourceFilter === 'web') fbFilter.source = 'web';
    else if (sourceFilter === 'slack') {
      fbFilter.source = 'slack';
      if (channelNames.length === 1) {
        fbFilter.channel_name = channelNames[0];
      } else if (channelNames.length > 1) {
        fbFilter.channel_name = { $in: channelNames };
      }
    }
    if (userEmails.length === 1) fbFilter.user_email = userEmails[0];
    else if (userEmails.length > 1) fbFilter.user_email = { $in: userEmails };

    const [fbOverall, fbBySource, fbCategories, fbDaily] = await Promise.all([
      // Overall counts
      feedbackColl.aggregate([
        { $match: fbFilter },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
      ]).toArray(),
      // By source
      feedbackColl.aggregate([
        { $match: fbFilter },
        { $group: { _id: { source: '$source', rating: '$rating' }, count: { $sum: 1 } } },
      ]).toArray(),
      // Negative feedback category breakdown (exclude generic thumbs_down — it's the
      // initial click, not a categorised reason; those users are still counted in the
      // overall negative total)
      feedbackColl.aggregate([
        { $match: { ...fbFilter, rating: 'negative', value: { $nin: ['thumbs_down'] } } },
        { $group: { _id: '$value', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      // Daily feedback trend
      feedbackColl.aggregate([
        { $match: fbFilter },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
              rating: '$rating',
            },
            count: { $sum: 1 },
          },
        },
      ]).toArray(),
    ]);

    const fbMap = new Map(fbOverall.map((f) => [f._id, f.count]));
    const positive = fbMap.get('positive') || 0;
    const negative = fbMap.get('negative') || 0;
    const total = positive + negative;

    // Build by_source breakdown
    const bySource: Record<string, { positive: number; negative: number }> = {};
    for (const row of fbBySource) {
      const src = row._id.source || 'unknown';
      if (!bySource[src]) bySource[src] = { positive: 0, negative: 0 };
      bySource[src][row._id.rating as 'positive' | 'negative'] = row.count;
    }

    // Build categories array
    const categories = fbCategories.map((c) => ({
      category: c._id || 'unknown',
      count: c.count,
    }));

    // Build daily trend
    const dailyFbMap = new Map<string, { positive: number; negative: number }>();
    for (const row of fbDaily) {
      const date = row._id.date;
      if (!dailyFbMap.has(date)) dailyFbMap.set(date, { positive: 0, negative: 0 });
      dailyFbMap.get(date)![row._id.rating as 'positive' | 'negative'] = row.count;
    }
    const dailyFeedback = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dayStart.setHours(0, 0, 0, 0);
      const dateKey = dayStart.toISOString().split('T')[0];
      const entry = dailyFbMap.get(dateKey);
      dailyFeedback.push({
        date: dateKey,
        positive: entry?.positive || 0,
        negative: entry?.negative || 0,
      });
    }

    const feedbackSummary = {
      positive,
      negative,
      total,
      satisfaction_rate: total > 0 ? Math.round((positive / total) * 1000) / 10 : 0,
      by_source: bySource,
      categories,
      daily: dailyFeedback,
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
          created_at: { $gte: rangeStart },
          ...msgOwnerFilter,
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
          created_at: { $gte: rangeStart },
          ...msgOwnerFilter,
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
          ...msgOwnerFilter,
        },
      },
      { $group: { _id: '$conversation_id' } },
      { $count: 'total' },
    ]).toArray();

    // Interrupted/incomplete — conversations that have assistant messages but none with is_final
    const conversationsWithAssistant = await messages.aggregate([
      { $match: { role: 'assistant', created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
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

    // Hourly activity heatmap (hour-of-day distribution over selected range)
    // Combine web messages + Slack interactions
    // Use $toDate to handle both Date objects and ISO string values for created_at
    const [hourlyWebActivity, hourlySlackActivity] = await Promise.all([
      sourceFilter !== 'slack'
        ? messages.aggregate([
            { $match: { 'metadata.source': 'web', created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
            { $addFields: { _ts: { $toDate: '$created_at' } } },
            { $group: { _id: { $hour: '$_ts' }, count: { $sum: 1 } } },
          ]).toArray()
        : Promise.resolve([]),
      sourceFilter !== 'web'
        ? messages.aggregate([
            { $match: { 'metadata.source': 'slack', created_at: { $gte: rangeStart } } },
            { $addFields: { _ts: { $toDate: '$created_at' } } },
            { $group: { _id: { $hour: '$_ts' }, count: { $sum: 1 } } },
          ]).toArray()
        : Promise.resolve([]),
    ]);

    const hourlyMap = new Map<number, number>();
    for (const h of hourlyWebActivity) hourlyMap.set(h._id, (hourlyMap.get(h._id) || 0) + h.count);
    for (const h of hourlySlackActivity) hourlyMap.set(h._id, (hourlyMap.get(h._id) || 0) + (h.count || 0));

    const hourlyHeatmap = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hourlyMap.get(hour) || 0,
    }));

    // ═══════════════════════════════════════════════════════════════
    // SLACK STATS (from conversations with source:"slack" or client_type:"slack")
    // ═══════════════════════════════════════════════════════════════
    let slack: any = undefined;

    try {
      const slackFilter: Record<string, any> = { ...SLACK_CONV_MATCH, created_at: { $gte: rangeStart } };
      if (channelNames.length > 0) {
        const names = channelNames.length === 1 ? channelNames[0] : { $in: channelNames };
        // Override $or with $and to combine slack match + channel match
        delete slackFilter.$or;
        slackFilter.$and = [
          SLACK_CONV_MATCH,
          { created_at: { $gte: rangeStart } },
          { $or: [{ 'slack_meta.channel_name': names }, { 'metadata.channel_name': names }] },
        ];
        delete slackFilter.created_at;
      }
      const slackHasData = await conversations.countDocuments(SLACK_CONV_MATCH, { limit: 1 });

      if (slackHasData > 0) {
        const platformConfig = await getCollection('platform_config');

        // Helper: coalesce old slack_meta and new metadata fields
        const userId = { $ifNull: ['$metadata.user_id', '$slack_meta.user_id'] };
        const escalated = { $ifNull: ['$metadata.escalated', '$slack_meta.escalated'] };
        const channelName = { $ifNull: ['$metadata.channel_name', '$slack_meta.channel_name'] };

        const [configDoc, slackTotal, slackUniqueUsers, slackResolution, slackDailyAgg, slackTopChannels] =
          await Promise.all([
            // Channel config
            platformConfig.findOne({ _id: 'channel_stats' as any }),
            // Total interactions (threads) in range
            conversations.countDocuments(slackFilter),
            // Unique Slack users
            conversations.aggregate([
              { $match: slackFilter },
              { $group: { _id: userId } },
              { $count: 'total' },
            ]).toArray(),
            // Resolution stats (non-escalated = resolved)
            conversations.aggregate([
              { $match: slackFilter },
              {
                $group: {
                  _id: null,
                  total_threads: { $sum: 1 },
                  escalated_threads: { $sum: { $cond: [escalated, 1, 0] } },
                },
              },
            ]).toArray(),
            // Daily breakdown
            conversations.aggregate([
              { $match: slackFilter },
              {
                $group: {
                  _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
                  interactions: { $sum: 1 },
                  unique_users: { $addToSet: userId },
                  resolved: { $sum: { $cond: [{ $not: [escalated] }, 1, 0] } },
                  escalated: { $sum: { $cond: [escalated, 1, 0] } },
                },
              },
              { $sort: { _id: 1 } },
            ]).toArray(),
            // Top channels
            conversations.aggregate([
              { $match: slackFilter },
              { $addFields: { _channelName: channelName } },
              { $match: { _channelName: { $ne: null } } },
              {
                $group: {
                  _id: '$_channelName',
                  interactions: { $sum: 1 },
                  resolved: { $sum: { $cond: [{ $not: [escalated] }, 1, 0] } },
                },
              },
              { $sort: { interactions: -1 } },
              { $limit: 10 },
            ]).toArray(),
          ]);

        const resolution = slackResolution[0] || { total_threads: 0, escalated_threads: 0 };
        const resolvedThreads = resolution.total_threads - resolution.escalated_threads;
        const resolutionRate = resolution.total_threads > 0
          ? Math.round((resolvedThreads / resolution.total_threads) * 1000) / 10
          : 0;

        // ── Per-thread hours estimation ─────────────────────────────
        //   positive feedback  → 4h
        //   negative feedback  → 0h
        //   no feedback, not escalated (self-resolved) → 4h
        //   no feedback, escalated → 10 min (0.167h)
        //
        // DocumentDB does not support $lookup with let/pipeline (correlated
        // subqueries), so we fetch conversations and feedback separately and
        // join in application code.
        const SELF_RESOLVED_HOURS = 4;
        const POSITIVE_FEEDBACK_HOURS = 4;
        const NO_FEEDBACK_MINUTES = 10;

        const [slackConvs, slackFeedback] = await Promise.all([
          conversations.find(slackFilter, {
            projection: { _id: 1, 'slack_meta.escalated': 1, 'metadata.escalated': 1 },
          }).toArray(),
          feedbackColl.find(
            {
              source: 'slack',
              created_at: { $gte: rangeStart },
              ...(channelNames.length === 1
                ? { channel_name: channelNames[0] }
                : channelNames.length > 1
                  ? { channel_name: { $in: channelNames } }
                  : {}),
            },
            { projection: { conversation_id: 1, rating: 1, created_at: 1 } },
          ).toArray(),
        ]);

        // Build map: conversation_id -> latest feedback rating
        const fbByConv = new Map<string, string>();
        for (const fb of slackFeedback) {
          const cid = fb.conversation_id;
          if (!cid) continue;
          const existing = fbByConv.get(cid);
          if (!existing) {
            fbByConv.set(cid, fb.rating);
          }
        }

        let estimatedHoursSaved = 0;
        for (const conv of slackConvs) {
          const cid = String(conv._id);
          const rating = fbByConv.get(cid);
          const escalated = conv.metadata?.escalated ?? conv.slack_meta?.escalated;

          if (rating === 'negative') {
            // 0 hours
          } else if (rating === 'positive') {
            estimatedHoursSaved += POSITIVE_FEEDBACK_HOURS;
          } else if (!rating && !escalated) {
            estimatedHoursSaved += SELF_RESOLVED_HOURS;
          } else {
            estimatedHoursSaved += NO_FEEDBACK_MINUTES / 60;
          }
        }
        estimatedHoursSaved = Math.round(estimatedHoursSaved * 10) / 10;

        // Build daily array with gaps filled
        const slackDailyMap = new Map(
          slackDailyAgg.map((d) => [d._id, {
            interactions: d.interactions,
            unique_users: d.unique_users?.length || 0,
            resolved: d.resolved,
            escalated: d.escalated,
          }])
        );
        const slackDaily = [];
        for (let i = days - 1; i >= 0; i--) {
          const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          dayStart.setHours(0, 0, 0, 0);
          const dateKey = dayStart.toISOString().split('T')[0];
          const entry = slackDailyMap.get(dateKey);
          slackDaily.push({
            date: dateKey,
            interactions: entry?.interactions || 0,
            unique_users: entry?.unique_users || 0,
            resolved: entry?.resolved || 0,
            escalated: entry?.escalated || 0,
          });
        }

        slack = {
          channels: configDoc
            ? { total: configDoc.total, qanda_enabled: configDoc.qanda_enabled, alerts_enabled: configDoc.alerts_enabled, ai_enabled: configDoc.ai_enabled }
            : { total: 0, qanda_enabled: 0, alerts_enabled: 0, ai_enabled: 0 },
          total_interactions: slackTotal,
          unique_users: slackUniqueUsers[0]?.total || 0,
          resolution: {
            total_threads: resolution.total_threads,
            resolved_threads: resolvedThreads,
            resolution_rate: resolutionRate,
            estimated_hours_saved: estimatedHoursSaved,
          },
          daily: slackDaily,
          top_channels: slackTopChannels.map((c) => ({
            channel_name: c._id,
            interactions: c.interactions,
            resolved: c.resolved,
            resolution_rate: c.interactions > 0
              ? Math.round((c.resolved / c.interactions) * 1000) / 10
              : 0,
          })),
        };
      }
    } catch (err) {
      // Slack data may not exist yet — silently skip
      console.warn('Slack stats query failed:', err);
    }

    // ═══════════════════════════════════════════════════════════════
    // PLATFORM SUMMARY — respects source/user filters
    // ═══════════════════════════════════════════════════════════════
    const includeWeb = sourceFilter !== 'slack';
    const includeSlack = sourceFilter !== 'web';

    // Web agent usage: count of assistant messages with agent_name for hours estimation
    const webAgentMessagesAgg = includeWeb
      ? await messages.countDocuments({
          role: 'assistant',
          'metadata.agent_name': { $exists: true, $ne: null },
          created_at: { $gte: rangeStart },
          ...msgOwnerFilter,
        })
      : 0;

    const slackHoursSaved = includeSlack ? (slack?.resolution?.estimated_hours_saved || 0) : 0;

    // Hours automated: web agent usage (10 min each) + Slack resolved threads (4h each)
    const webHoursAutomated = Math.round((webAgentMessagesAgg * 10) / 60 * 10) / 10; // 10 min per agent response
    const totalHoursAutomated = Math.round((webHoursAutomated + slackHoursSaved) * 10) / 10;

    // Collect available channel names from both old and new schema
    const [oldChannels, newChannels] = await Promise.all([
      conversations.distinct(
        'slack_meta.channel_name',
        { source: 'slack', 'slack_meta.channel_name': { $ne: null } },
      ),
      conversations.distinct(
        'metadata.channel_name',
        { client_type: 'slack', 'metadata.channel_name': { $ne: null } },
      ),
    ]);
    const availableChannels = [...new Set([...oldChannels, ...newChannels])];

    const platformSummary = {
      satisfaction_rate: feedbackSummary.satisfaction_rate || 0,
      estimated_hours_automated: totalHoursAutomated,
    };

    return successResponse({
      range: searchParams.get('range') || '30d',
      days,
      platform_summary: platformSummary,
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
      ...(slack ? { slack } : {}),
      available_channels: availableChannels.sort(),
    });
  });
});
