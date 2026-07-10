// GET /api/admin/stats - Get platform usage statistics

import {
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection,isMongoDBConfigured } from '@/lib/mongodb';
import { requireAdminSurfaceManage } from '@/lib/rbac/require-openfga';
import { getReadableSlackChannelNames } from '@/lib/rbac/user-insights-scope';
import {
createJsonResponseCacheStore,
envTtlMs,
withJsonResponseCache,
} from '@/lib/server-response-cache';
import { NextRequest,NextResponse } from 'next/server';

const adminStatsCache = createJsonResponseCacheStore();

type BucketUnit = 'hour' | 'day';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Mongo $dateToString format for a bucket granularity (UTC, matches Date#toISOString below). */
const BUCKET_DATE_FORMAT: Record<BucketUnit, string> = {
  hour: '%Y-%m-%dT%H:00',
  day: '%Y-%m-%d',
};

/** Render a bucket start Date into the same key format $dateToString produces above. */
function bucketDateKey(d: Date, unit: BucketUnit): string {
  return unit === 'hour' ? `${d.toISOString().slice(0, 13)}:00` : d.toISOString().split('T')[0];
}

/** Generate the ordered (oldest → newest) list of bucket keys covering `now` back `count` buckets of `unit` size. */
function generateBucketKeys(now: Date, count: number, unit: BucketUnit): string[] {
  const stepMs = unit === 'hour' ? HOUR_MS : DAY_MS;
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * stepMs);
    if (unit === 'hour') d.setMinutes(0, 0, 0);
    else d.setHours(0, 0, 0, 0);
    keys.push(bucketDateKey(d, unit));
  }
  return keys;
}

/**
 * Parse range params into { rangeStart, days, bucketUnit, bucketCount }. Supports preset
 * strings and explicit from/to ISO dates. Ranges of a day or less bucket by hour (rather
 * than clamping to a single day-granularity bucket) so 1h/12h/24h charts show more than
 * one data point.
 */
function parseRange(searchParams: URLSearchParams): { rangeStart: Date; days: number; bucketUnit: BucketUnit; bucketCount: number } {
  const now = new Date();
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');

  let rangeStart: Date;
  let ms: number;

  if (fromParam) {
    const from = new Date(fromParam);
    const to = toParam ? new Date(toParam) : now;
    ms = to.getTime() - from.getTime();
    rangeStart = from;
  } else {
    const range = searchParams.get('range');
    switch (range) {
      case '1h':  ms = HOUR_MS; break;
      case '12h': ms = 12 * HOUR_MS; break;
      case '24h':
      case '1d':  ms = DAY_MS; break;
      case '7d':  ms = 7 * DAY_MS; break;
      case '90d': ms = 90 * DAY_MS; break;
      case '30d':
      default:    ms = 30 * DAY_MS; break;
    }
    rangeStart = new Date(now.getTime() - ms);
  }

  const days = Math.max(1, Math.round(ms / DAY_MS));
  const bucketUnit: BucketUnit = ms <= DAY_MS ? 'hour' : 'day';
  const bucketCount = bucketUnit === 'hour' ? Math.max(1, Math.round(ms / HOUR_MS)) : days;
  return { rangeStart, days, bucketUnit, bucketCount };
}

/**
 * Merge `clause` into an existing Mongo filter without clobbering keys. When
 * `target` already has conditions we wrap both in `$and` (rather than spreading,
 * which would silently drop a duplicate key like `$or`). Mutates `target`.
 */
function andInto(target: Record<string, unknown>, clause: Record<string, unknown>): void {
  const existingKeys = Object.keys(target);
  if (existingKeys.length === 0) {
    Object.assign(target, clause);
    return;
  }
  const saved = { ...target };
  for (const k of existingKeys) delete target[k];
  target.$and = [saved, clause];
}

// GET /api/admin/stats
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withJsonResponseCache(request, adminStatsCache, () => getAdminStats(request), {
    ttlMs: envTtlMs('ADMIN_STATS_CACHE_TTL_MS', 15_000),
    maxEntries: 512,
  });
});

async function getAdminStats(request: NextRequest) {
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

  const { session } = await getAuthFromBearerOrSession(request);
  const isFullAdmin = await requireAdminSurfaceManage(session, 'stats').then(() => true, () => false);

  // Non-admin: scope to their readable Slack channels + their own web conversations.
  let nonAdminScope: { channelNames: string[]; ownerEmail: string } | null = null;
  if (!isFullAdmin) {
    const sub = typeof session.sub === 'string' ? session.sub.trim() : '';
    const email = typeof session.user?.email === 'string' ? session.user.email.trim() : '';
    if (!sub && !email) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    const channelNames = sub ? await getReadableSlackChannelNames(`user:${sub}`) : [];
    nonAdminScope = { channelNames, ownerEmail: email };
  }

    const { searchParams } = new URL(request.url);
    const { rangeStart, days, bucketUnit, bucketCount } = parseRange(searchParams);

    // Optional filters
    const sourceFilter = searchParams.get('source'); // 'web' | 'slack' | null (all)
    const userFilter = searchParams.get('user'); // comma-separated emails | null (all)
    const userEmails = userFilter ? userFilter.split(',').map((u) => u.trim()).filter(Boolean) : [];
    const channelFilter = searchParams.get('channel'); // comma-separated channel names (slack only)
    const channelNames = channelFilter ? channelFilter.split(',').map((c) => c.trim()).filter(Boolean) : [];

    // Build reusable filter fragments for conversations and messages.
    // Support both legacy (source/slack_meta) and new (client_type/metadata) schemas.
    const SLACK_CONV_MATCH = { $or: [{ source: 'slack' }, { client_type: 'slack' }] };

    // A non-admin view is always "filtered" — DAU/MAU and daily-user activity
    // must derive from the scoped conversations, never from the platform-wide
    // users collection (which would leak global active-user counts).
    const hasFilters = !!sourceFilter || userEmails.length > 0 || !!nonAdminScope;
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

    // Non-admin scope, reused by every query below so the whole payload stays
    // within the caller's visibility:
    //   - `nonAdminScopeFilter` matches conversations/web-messages the user may
    //     see (their readable Slack channels OR their own web conversations).
    //   - `nonAdminChannelNames` bounds Slack-channel-keyed queries (feedback,
    //     the Slack block, available_channels). Slack docs in the `messages`
    //     collection carry no channel_name, so Slack message counts can only
    //     be bounded by owner_id via the shared scope filter.
    let nonAdminScopeFilter: Record<string, unknown> | null = null;
    const nonAdminChannelNames = nonAdminScope?.channelNames ?? [];
    if (nonAdminScope) {
      const { channelNames: scopeChannelNames, ownerEmail } = nonAdminScope;
      const scopeClauses: Record<string, unknown>[] = [];
      if (scopeChannelNames.length > 0) {
        const names = scopeChannelNames.length === 1 ? scopeChannelNames[0] : { $in: scopeChannelNames };
        scopeClauses.push({
          $and: [
            { $or: [{ source: 'slack' }, { client_type: 'slack' }] },
            { $or: [
              { 'slack_meta.channel_name': names },
              { 'metadata.channel_name': names },
            ]},
          ],
        });
      }
      if (ownerEmail) scopeClauses.push({ owner_id: ownerEmail });

      if (scopeClauses.length === 0) {
        return successResponse({
          range: searchParams.get('range') || '30d',
          days,
          platform_summary: { satisfaction_rate: 0, estimated_hours_automated: 0 },
          overview: {
            total_users: 0,
            total_conversations: 0,
            total_messages: 0,
            shared_conversations: 0,
            dau: 0,
            mau: 0,
            conversations_today: 0,
            messages_today: 0,
            avg_messages_per_conversation: 0,
          },
          daily_activity: [],
          top_users: { by_conversations: [], by_messages: [] },
          top_agents: [],
          feedback_summary: {
            positive: 0,
            negative: 0,
            total: 0,
            satisfaction_rate: 0,
            by_source: {},
            categories: [],
            daily: [],
          },
          response_time: { avg_ms: 0, min_ms: 0, max_ms: 0, sample_count: 0 },
          hourly_heatmap: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
          completed_workflows: {
            total: 0,
            today: 0,
            interrupted: 0,
            completion_rate: 0,
            avg_messages_per_workflow: 0,
          },
          available_channels: [],
        });
      }

      nonAdminScopeFilter = scopeClauses.length === 1 ? scopeClauses[0] : { $or: scopeClauses };
      andInto(convSourceFilter, nonAdminScopeFilter);
      andInto(msgOwnerFilter, nonAdminScopeFilter);
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
      totalMessages,
      dau,
      mau,
      conversationsToday,
      messagesToday,
      sharedConversations,
    ] = await Promise.all([
      // Non-admins must not see platform-wide headcount — derive their
      // total_users from distinct owners of the conversations they can see.
      nonAdminScope
        ? conversations.aggregate([
            { $match: { ...convSourceFilter } },
            { $group: { _id: '$owner_id' } },
            { $count: 'total' },
          ]).toArray().then((r) => r[0]?.total || 0)
        : users.countDocuments({}),
      // Scoped to the selected date range (rangeStart), matching daily_activity
      // and every other range-aware metric below — previously these were
      // always lifetime totals regardless of the selected range.
      conversations.countDocuments({ created_at: { $gte: rangeStart }, ...convSourceFilter }),
      // msgOwnerFilter already carries 'metadata.source' when the caller
      // explicitly filtered by source=web|slack; unfiltered, this counts
      // every message regardless of metadata.source (including messages
      // missing that field or tagged with other values, e.g. 'scheduler'),
      // matching how totalConversations counts every conversation.
      messages.countDocuments({ created_at: { $gte: rangeStart }, ...msgOwnerFilter }),
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
      messages.countDocuments({ created_at: { $gte: today }, ...msgOwnerFilter }),
      // `andInto` rather than spreading a literal `$or` — the non-admin scope
      // can itself be an `$or`, which a spread would clobber (leaking shared
      // conversation counts outside the caller's scope).
      conversations.countDocuments(
        (() => {
          const sharedFilter: Record<string, unknown> = { ...convSourceFilter };
          andInto(sharedFilter, {
            $or: [
              { 'sharing.shared_with.0': { $exists: true } },
              { 'sharing.shared_with_teams.0': { $exists: true } },
              { 'sharing.share_link_enabled': true },
            ],
          });
          return sharedFilter;
        })()
      ),
    ]);

    // ═══════════════════════════════════════════════════════════════
    // PARALLEL BATCH — all independent aggregations in one shot
    // ═══════════════════════════════════════════════════════════════
    const feedbackColl = await getCollection('feedback'); // collection ref is instant; fetch inside the batch below

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

    // Non-admin: feedback is keyed by channel_name (slack) / user_email (web),
    // so scope it directly rather than via the conversation-shaped scope filter.
    if (nonAdminScope) {
      const fbScope: Record<string, unknown>[] = [];
      if (nonAdminChannelNames.length > 0) {
        fbScope.push({
          source: 'slack',
          channel_name: nonAdminChannelNames.length === 1
            ? nonAdminChannelNames[0]
            : { $in: nonAdminChannelNames },
        });
      }
      if (nonAdminScope.ownerEmail) fbScope.push({ user_email: nonAdminScope.ownerEmail });
      andInto(fbFilter, fbScope.length === 1 ? fbScope[0] : { $or: fbScope });
    }

    const [
      dailyUserActivity,
      dailyConvActivity,
      dailyMsgActivity,
      rawTopByConvs,
      rawTopByMsgs,
      topAgents,
      fbOverall,
      fbBySource,
      fbCategories,
      fbDaily,
      latencyAgg,
      completedWorkflows,
      completedToday,
      conversationsWithAssistant,
      hourlyActivity,
      availableChannelsResult,
      webAgentMsgCount,
    ] = await Promise.all([
      // Daily active users
      hasFilters
        ? conversations.aggregate([
            { $match: { updated_at: { $gte: rangeStart }, ...convSourceFilter } },
            { $group: { _id: { date: { $dateToString: { format: BUCKET_DATE_FORMAT[bucketUnit], date: '$updated_at' } }, user: '$owner_id' } } },
            { $group: { _id: '$_id.date', active_users: { $sum: 1 } } },
          ]).toArray()
        : users.aggregate([
            { $match: { last_login: { $gte: rangeStart } } },
            { $group: { _id: { $dateToString: { format: BUCKET_DATE_FORMAT[bucketUnit], date: '$last_login' } }, active_users: { $sum: 1 } } },
          ]).toArray(),

      // Daily conversations
      conversations.aggregate([
        { $match: { created_at: { $gte: rangeStart }, ...convSourceFilter } },
        { $group: { _id: { $dateToString: { format: BUCKET_DATE_FORMAT[bucketUnit], date: '$created_at' } }, conversations: { $sum: 1 } } },
      ]).toArray(),

      // Daily messages — msgOwnerFilter already carries metadata.source
      // when source=web|slack was explicitly requested; unfiltered, this
      // counts every message regardless of metadata.source.
      messages.aggregate([
        { $match: { created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
        { $group: { _id: { $dateToString: { format: BUCKET_DATE_FORMAT[bucketUnit], date: '$created_at' } }, messages: { $sum: 1 } } },
      ]).toArray(),

      // Top users by conversations
      conversations.aggregate([
        { $match: { created_at: { $gte: rangeStart }, ...convSourceFilter } },
        { $group: { _id: '$owner_id', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray(),

      // Top users by messages ($lookup for legacy owner_id)
      messages.aggregate([
        { $match: { created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
        { $lookup: { from: 'conversations', localField: 'conversation_id', foreignField: '_id', as: '_conv' } },
        { $addFields: { _owner: { $ifNull: ['$owner_id', { $arrayElemAt: ['$_conv.owner_id', 0] }] } } },
        { $match: { _owner: { $ne: null } } },
        { $group: { _id: '$_owner', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray(),

      // Top agents
      messages.aggregate([
        { $match: { role: 'assistant', 'metadata.agent_name': { $exists: true, $ne: null }, created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
        { $group: { _id: '$metadata.agent_name', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray(),

      // Feedback: overall counts
      feedbackColl.aggregate([
        { $match: fbFilter },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
      ]).toArray(),

      // Feedback: by source
      feedbackColl.aggregate([
        { $match: fbFilter },
        { $group: { _id: { source: '$source', rating: '$rating' }, count: { $sum: 1 } } },
      ]).toArray(),

      // Feedback: negative categories
      feedbackColl.aggregate([
        { $match: { ...fbFilter, rating: 'negative', value: { $nin: ['thumbs_down'] } } },
        { $group: { _id: '$value', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),

      // Feedback: daily trend
      feedbackColl.aggregate([
        { $match: fbFilter },
        { $group: { _id: { date: { $dateToString: { format: BUCKET_DATE_FORMAT[bucketUnit], date: '$created_at' } }, rating: '$rating' }, count: { $sum: 1 } } },
      ]).toArray(),

      // Response latency
      messages.aggregate([
        { $match: { role: 'assistant', 'metadata.latency_ms': { $exists: true, $gt: 0 }, created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
        { $group: { _id: null, avg_latency: { $avg: '$metadata.latency_ms' }, min_latency: { $min: '$metadata.latency_ms' }, max_latency: { $max: '$metadata.latency_ms' }, count: { $sum: 1 } } },
      ]).toArray(),

      // Completed workflows (total)
      messages.aggregate([
        { $match: { role: 'assistant', 'metadata.is_final': true, created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
        { $group: { _id: '$conversation_id' } },
        { $count: 'total' },
      ]).toArray(),

      // Completed workflows (today)
      messages.aggregate([
        { $match: { role: 'assistant', 'metadata.is_final': true, created_at: { $gte: today }, ...msgOwnerFilter } },
        { $group: { _id: '$conversation_id' } },
        { $count: 'total' },
      ]).toArray(),

      // All conversations with assistant messages (for interrupted count)
      messages.aggregate([
        { $match: { role: 'assistant', created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
        { $group: { _id: '$conversation_id', has_final: { $max: { $cond: [{ $eq: ['$metadata.is_final', true] }, 1, 0] } }, last_msg_at: { $max: '$created_at' }, msg_count: { $sum: 1 } } },
        { $sort: { last_msg_at: -1 } },
      ]).toArray(),

      // Hourly heatmap — msgOwnerFilter already carries metadata.source
      // when source=web|slack was explicitly requested; unfiltered, this
      // counts every message regardless of metadata.source.
      messages.aggregate([
        { $match: { created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
        { $addFields: { _ts: { $toDate: '$created_at' } } },
        { $group: { _id: { $hour: '$_ts' }, count: { $sum: 1 } } },
      ]).toArray(),

      // Available channel names (both schema variants). Non-admins get exactly
      // their readable channels (resolved after this batch) — a platform-wide
      // distinct would enumerate every channel name, so skip it for them.
      nonAdminScope
        ? Promise.resolve([[], []] as [string[], string[]])
        : Promise.all([
            conversations.distinct('slack_meta.channel_name', { source: 'slack', 'slack_meta.channel_name': { $ne: null } }),
            conversations.distinct('metadata.channel_name', { client_type: 'slack', 'metadata.channel_name': { $ne: null } }),
          ]),

      // Web agent message count for hours-automated estimate
      sourceFilter !== 'slack'
        ? messages.countDocuments({
            role: 'assistant',
            'metadata.agent_name': { $exists: true, $ne: null },
            created_at: { $gte: rangeStart },
            ...msgOwnerFilter,
          })
        : Promise.resolve(0),
    ]);

    // ── Post-process daily activity ─────────────────────────────────
    const msgMap = new Map<string, number>();
    for (const d of dailyMsgActivity) msgMap.set(d._id, (msgMap.get(d._id) || 0) + d.messages);

    const userMap = new Map(dailyUserActivity.map((d) => [d._id, d.active_users]));
    const convMap = new Map(dailyConvActivity.map((d) => [d._id, d.conversations]));

    const dailyActivity = generateBucketKeys(now, bucketCount, bucketUnit).map((dateKey) => ({
      date: dateKey,
      active_users: userMap.get(dateKey) || 0,
      conversations: convMap.get(dateKey) || 0,
      messages: msgMap.get(dateKey) || 0,
    }));

    // ── Top users: resolve display names ───────────────────────────
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
      raw.map((u) => ({ _id: u._id, count: u.count, name: nameByOwner.get(u._id) || u._id }));

    const topUsersByConversations = enrichTopUsers(rawTopByConvs);
    const topUsersByMessages = enrichTopUsers(rawTopByMsgs);

    // ── Post-process feedback ───────────────────────────────────────
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
    const dailyFeedback = generateBucketKeys(now, bucketCount, bucketUnit).map((dateKey) => {
      const entry = dailyFbMap.get(dateKey);
      return {
        date: dateKey,
        positive: entry?.positive || 0,
        negative: entry?.negative || 0,
      };
    });

    const feedbackSummary = {
      positive,
      negative,
      total,
      satisfaction_rate: total > 0 ? Math.round((positive / total) * 1000) / 10 : 0,
      by_source: bySource,
      categories,
      daily: dailyFeedback,
    };

    // ── Post-process latency / workflows / heatmap ─────────────────
    const avgMsgsPerConv = totalConversations > 0
      ? Math.round((totalMessages / totalConversations) * 10) / 10
      : 0;

    const responseTime = latencyAgg[0]
      ? {
          avg_ms: Math.round(latencyAgg[0].avg_latency),
          min_ms: latencyAgg[0].min_latency,
          max_ms: latencyAgg[0].max_latency,
          sample_count: latencyAgg[0].count,
        }
      : { avg_ms: 0, min_ms: 0, max_ms: 0, sample_count: 0 };

    const completedCount = completedWorkflows[0]?.total || 0;
    const completedTodayCount = completedToday[0]?.total || 0;
    const totalWithAssistant = conversationsWithAssistant.length;
    const interruptedCount = conversationsWithAssistant.filter((c) => c.has_final === 0).length;
    const completionRate = totalWithAssistant > 0
      ? Math.round((completedCount / totalWithAssistant) * 1000) / 10
      : 0;

    const completedConvs = conversationsWithAssistant.filter((c) => c.has_final === 1);
    const avgMsgsCompleted = completedConvs.length > 0
      ? Math.round((completedConvs.reduce((sum, c) => sum + c.msg_count, 0) / completedConvs.length) * 10) / 10
      : 0;

    const hourlyMap = new Map<number, number>();
    for (const h of hourlyActivity) hourlyMap.set(h._id, (hourlyMap.get(h._id) || 0) + h.count);

    const hourlyHeatmap = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hourlyMap.get(hour) || 0,
    }));

    // ═══════════════════════════════════════════════════════════════
    // SLACK STATS (from conversations with source:"slack" or client_type:"slack")
    // ═══════════════════════════════════════════════════════════════
    let slack: any = undefined;

    // Slack block channel scope: admins use the `channel` query param; a
    // non-admin is hard-bounded to their readable channels (their web
    // conversations don't appear in this Slack-only section). A non-admin with
    // no readable channels sees no Slack block at all.
    const slackChannelScope = nonAdminScope ? nonAdminChannelNames : channelNames;
    const skipSlackBlock = !!nonAdminScope && nonAdminChannelNames.length === 0;

    try {
      const slackFilter: Record<string, any> = { ...SLACK_CONV_MATCH, created_at: { $gte: rangeStart } };
      if (slackChannelScope.length > 0) {
        const names = slackChannelScope.length === 1 ? slackChannelScope[0] : { $in: slackChannelScope };
        // Override $or with $and to combine slack match + channel match
        delete slackFilter.$or;
        slackFilter.$and = [
          SLACK_CONV_MATCH,
          { created_at: { $gte: rangeStart } },
          { $or: [{ 'slack_meta.channel_name': names }, { 'metadata.channel_name': names }] },
        ];
        delete slackFilter.created_at;
      }
      const slackHasData = skipSlackBlock ? 0 : await conversations.countDocuments(SLACK_CONV_MATCH, { limit: 1 });

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
                  _id: { $dateToString: { format: BUCKET_DATE_FORMAT[bucketUnit], date: '$created_at' } },
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
              ...(slackChannelScope.length === 1
                ? { channel_name: slackChannelScope[0] }
                : slackChannelScope.length > 1
                  ? { channel_name: { $in: slackChannelScope } }
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
        const slackDaily = generateBucketKeys(now, bucketCount, bucketUnit).map((dateKey) => {
          const entry = slackDailyMap.get(dateKey);
          return {
            date: dateKey,
            interactions: entry?.interactions || 0,
            unique_users: entry?.unique_users || 0,
            resolved: entry?.resolved || 0,
            escalated: entry?.escalated || 0,
          };
        });

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

    const webAgentMessagesAgg = includeWeb ? (webAgentMsgCount as number) : 0;

    const slackHoursSaved = includeSlack ? (slack?.resolution?.estimated_hours_saved || 0) : 0;

    // Hours automated: web agent usage (10 min each) + Slack resolved threads (4h each)
    const webHoursAutomated = Math.round((webAgentMessagesAgg * 10) / 60 * 10) / 10;
    const totalHoursAutomated = Math.round((webHoursAutomated + slackHoursSaved) * 10) / 10;

    const [oldChannels, newChannels] = availableChannelsResult;
    const availableChannels = nonAdminScope
      ? [...new Set(nonAdminChannelNames)]
      : [...new Set([...oldChannels, ...newChannels])];

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
}
