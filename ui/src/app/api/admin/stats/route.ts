// GET /api/admin/stats - Get platform usage statistics

import {
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection,isMongoDBConfigured } from '@/lib/mongodb';
import {
resolveAuthorizedAdminSimulationScope,
simulationSubjectCanManageAdminSurface,
} from '@/lib/rbac/admin-simulation-server';
import { requireAdminSurfaceManage } from '@/lib/rbac/require-openfga';
import { getAgentsByIds, getAllAgents, getOwnedAgentConversationIds, getOwnedAgents, getReadableSlackChannelNames, type OwnedAgent } from '@/lib/rbac/user-insights-scope';
import {
createJsonResponseCacheStore,
envTtlMs,
withJsonResponseCache,
} from '@/lib/server-response-cache';
import type { Document } from 'mongodb';
import { NextRequest,NextResponse } from 'next/server';

const adminStatsCache = createJsonResponseCacheStore();

interface SlackStats {
  channels: {
    ai_enabled?: number;
    alerts_enabled?: number;
    qanda_enabled?: number;
    total?: number;
  };
  configured_channels?: number;
  configured_channels_daily?: Array<{
    date: string;
    total: number;
  }>;
  daily: Array<{
    date: string;
    escalated: number;
    interactions: number;
    resolved: number;
    unique_users: number;
  }>;
  resolution: {
    estimated_hours_saved: number;
    resolution_rate: number;
    resolved_threads: number;
    total_threads: number;
  };
  top_channels: Array<{
    channel_name: string;
    interactions: number;
    resolution_rate: number;
    resolved: number;
  }>;
  total_interactions: number;
  unique_users: number;
}

interface ChannelStatsDocument extends Document {
  _id: string;
  ai_enabled?: number;
  alerts_enabled?: number;
  qanda_enabled?: number;
  total?: number;
}

type BucketUnit = 'minute' | 'hour' | 'day';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Ranges this short bucket by 5-minute intervals so 1h/12h-style short
// windows show more than a single point (a single hourly bucket would
// otherwise collapse a 1h range to exactly one data point).
const MINUTE_BUCKET_THRESHOLD_MS = 2 * HOUR_MS;
const MINUTE_BUCKET_STEP_MIN = 5;

/** Mongo $dateToString format for a bucket granularity (UTC, matches Date#toISOString below). */
const BUCKET_DATE_FORMAT: Record<BucketUnit, string> = {
  minute: '%Y-%m-%dT%H:%M',
  hour: '%Y-%m-%dT%H:00',
  day: '%Y-%m-%d',
};

/** Render a bucket start Date into the same key format $dateToString produces above. */
function bucketDateKey(d: Date, unit: BucketUnit): string {
  if (unit === 'minute') return d.toISOString().slice(0, 16);
  if (unit === 'hour') return `${d.toISOString().slice(0, 13)}:00`;
  return d.toISOString().split('T')[0];
}

/** Floor `d` down to the start of the bucket it falls in, mutating a copy. */
function floorToBucket(d: Date, unit: BucketUnit): Date {
  const floored = new Date(d);
  if (unit === 'minute') {
    floored.setSeconds(0, 0);
    floored.setMinutes(Math.floor(floored.getMinutes() / MINUTE_BUCKET_STEP_MIN) * MINUTE_BUCKET_STEP_MIN);
  } else if (unit === 'hour') {
    floored.setMinutes(0, 0, 0);
  } else {
    floored.setHours(0, 0, 0, 0);
  }
  return floored;
}

/** Generate the ordered (oldest → newest) list of bucket keys covering `now` back `count` buckets of `unit` size. */
function generateBucketKeys(now: Date, count: number, unit: BucketUnit): string[] {
  const stepMs = unit === 'minute' ? MINUTE_BUCKET_STEP_MIN * MINUTE_MS : unit === 'hour' ? HOUR_MS : DAY_MS;
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = floorToBucket(new Date(now.getTime() - i * stepMs), unit);
    keys.push(bucketDateKey(d, unit));
  }
  return keys;
}

/**
 * Parse range params into { rangeStart, days, bucketUnit, bucketCount }. Supports preset
 * strings and explicit from/to ISO dates. Short ranges bucket at finer granularity (minute
 * for ≤2h, hour for ≤1d) rather than clamping to day-granularity, so 1h/12h/24h charts show
 * more than one data point.
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
  const bucketUnit: BucketUnit = ms <= MINUTE_BUCKET_THRESHOLD_MS ? 'minute' : ms <= DAY_MS ? 'hour' : 'day';
  const bucketCount =
    bucketUnit === 'minute' ? Math.max(1, Math.round(ms / (MINUTE_BUCKET_STEP_MIN * MINUTE_MS))) :
    bucketUnit === 'hour' ? Math.max(1, Math.round(ms / HOUR_MS)) :
    days;
  return { rangeStart, days, bucketUnit, bucketCount };
}

// ── Human vs. bot identity ──────────────────────────────────────────────────
// "Top users" should reflect people, not the bot/service identities that own
// automated Slack posts (alerts, scheduled pipelines, MR bots). Human owners
// are keyed by email (contain '@'); Slack bot posters surface as bot IDs
// ("B0…"), the literal "unknown", the Slackbot sentinel, or platform service
// accounts. We exclude those so the leaderboard is people-only.
const BOT_OWNER_EXACT = ['unknown', 'USLACKBOT'];
/** Mongo match fragment (spread into a $match) that keeps only human owners. */
const HUMAN_OWNER_MATCH: Record<string, unknown> = {
  $and: [
    { _id: { $nin: BOT_OWNER_EXACT } },
    // Bot user IDs are "B" + uppercase/digits (e.g. B04741LSXBJ); real Slack
    // user IDs start "U"/"W" and web owners are emails, so this only drops bots.
    { _id: { $not: /^B[A-Z0-9]{6,}$/ } },
    { _id: { $not: /^service-account-/ } },
  ],
};

/**
 * A Slack thread is a "user question" (a candidate for self-resolution and
 * hours-saved credit) only when a human initiated it. Automated posts
 * (`bot`, `alert`) and threads with no interaction type are excluded — they
 * are broadcasts, not questions the assistant resolved. This mirrors the
 * distribution seen in the data: mention/qanda/dm are human-initiated.
 */
const USER_QUESTION_INTERACTION_TYPES = ['mention', 'qanda', 'dm', 'user'];

/** Turn an internal agent id/name into a display label ("agent-gitlab-agent" → "Gitlab Agent"). */
function humanizeAgentName(raw: string): string {
  const stripped = raw.replace(/^agent-/, '').replace(/[-_]+/g, ' ').trim();
  if (!stripped) return raw;
  return stripped.replace(/\b\w/g, (c) => c.toUpperCase());
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
  const { searchParams } = request.nextUrl;
  const simulationScope = await resolveAuthorizedAdminSimulationScope(searchParams, session);
  const isFullAdmin = simulationScope
    ? await simulationSubjectCanManageAdminSurface(simulationScope, 'stats')
    : await requireAdminSurfaceManage(session, 'stats').then(() => true, () => false);

  // Non-admin: scope to their readable Slack channels, their own web
  // conversations, AND the agents they own (directly or via a team). The
  // owned-agent axis lets an agent owner see usage of their agent even in
  // channels they can't read / web chats that aren't theirs.
  let nonAdminScope: { channelNames: string[]; ownerEmail: string; ownedAgents: OwnedAgent[] } | null = null;
  if (!isFullAdmin) {
    const openfgaUser = simulationScope?.openfgaUser ?? (
      typeof session.sub === 'string' && session.sub.trim()
        ? `user:${session.sub.trim()}`
        : ''
    );
    const email = simulationScope?.ownerEmail ?? (
      typeof session.user?.email === 'string' ? session.user.email.trim() : ''
    );
    if (!openfgaUser && !email) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    const [channelNames, ownedAgents] = await Promise.all([
      openfgaUser ? getReadableSlackChannelNames(openfgaUser) : Promise.resolve([]),
      openfgaUser ? getOwnedAgents(openfgaUser) : Promise.resolve([]),
    ]);
    nonAdminScope = { channelNames, ownerEmail: email, ownedAgents };
  }

    const { rangeStart, days, bucketUnit, bucketCount } = parseRange(searchParams);

    // Optional filters
    const sourceFilter = searchParams.get('source'); // 'web' | 'slack' | null (all)
    const userFilter = searchParams.get('user'); // comma-separated emails | null (all)
    const userEmails = userFilter ? userFilter.split(',').map((u) => u.trim()).filter(Boolean) : [];
    const channelFilter = searchParams.get('channel'); // comma-separated channel names (slack only)
    const channelNames = channelFilter ? channelFilter.split(',').map((c) => c.trim()).filter(Boolean) : [];
    const agentFilter = searchParams.get('agent'); // comma-separated agent ids (dynamic agents)
    const agentIds = agentFilter ? agentFilter.split(',').map((a) => a.trim()).filter(Boolean) : [];
    // Top-users leaderboard: by default we hide bot/service identities (alert
    // posters, MR bots, service accounts). `include_bots=true` shows them —
    // surfaced as a "Show Bot Users" toggle in the UI.
    const includeBots = searchParams.get('include_bots') === 'true';
    // A no-op $match spread when bots are included; drops non-humans otherwise.
    const topUserOwnerMatch: Record<string, unknown>[] = includeBots ? [] : [{ $match: HUMAN_OWNER_MATCH }];

    // Build reusable filter fragments for conversations and messages.
    // Support both legacy (source/slack_meta) and new (client_type/metadata) schemas.
    const SLACK_CONV_MATCH = { $or: [{ source: 'slack' }, { client_type: 'slack' }] };

    // A non-admin view is always "filtered" — DAU/MAU and daily-user activity
    // must derive from the scoped conversations, never from the platform-wide
    // users collection (which would leak global active-user counts).
    const hasFilters = !!sourceFilter || userEmails.length > 0 || !!nonAdminScope;
    const convSourceFilter: Document = {};
    const msgOwnerFilter: Document = {};
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
    //   - `convSourceFilter` / `msgOwnerFilter` get an $or of the caller's
    //     readable Slack channels, their own web conversations, AND their owned
    //     agents (keyed per-collection: conv → thread_owner_agent_id (id),
    //     msg → agent_name (display name)).
    //   - `nonAdminChannelNames` bounds Slack-channel-keyed queries (feedback,
    //     the Slack block, available_channels). Slack docs in the `messages`
    //     collection carry no channel_name, so Slack message counts can only
    //     be bounded by owner_id / agent via the shared scope filter.
    const nonAdminChannelNames = nonAdminScope?.channelNames ?? [];
    const nonAdminOwnedAgents = nonAdminScope?.ownedAgents ?? [];
    if (nonAdminScope) {
      const { channelNames: scopeChannelNames, ownerEmail, ownedAgents } = nonAdminScope;
      // Base clauses apply to both collections: readable Slack channels (only
      // ever match conversation-shaped docs) + the caller's own web content.
      const baseScopeClauses: Record<string, unknown>[] = [];
      if (scopeChannelNames.length > 0) {
        const names = scopeChannelNames.length === 1 ? scopeChannelNames[0] : { $in: scopeChannelNames };
        baseScopeClauses.push({
          $and: [
            { $or: [{ source: 'slack' }, { client_type: 'slack' }] },
            { $or: [
              { 'slack_meta.channel_name': names },
              { 'metadata.channel_name': names },
            ]},
          ],
        });
      }
      if (ownerEmail) baseScopeClauses.push({ owner_id: ownerEmail });

      // Owned-agent axis is keyed differently per collection: conversations
      // record the agent id (Slack), messages record the display name (web).
      const ownedAgentIds = ownedAgents.map((a) => a.id);
      const ownedAgentNames = ownedAgents.map((a) => a.name);
      const convScopeClauses = [...baseScopeClauses];
      const msgScopeClauses = [...baseScopeClauses];
      if (ownedAgentIds.length > 0) {
        convScopeClauses.push({ 'metadata.thread_owner_agent_id': { $in: ownedAgentIds } });
        msgScopeClauses.push({ 'metadata.agent_name': { $in: ownedAgentNames } });
      }

      if (convScopeClauses.length === 0 && msgScopeClauses.length === 0) {
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
          available_agents: [],
        });
      }

      const convFilter = convScopeClauses.length === 1 ? convScopeClauses[0] : { $or: convScopeClauses };
      const msgFilter = msgScopeClauses.length === 1 ? msgScopeClauses[0] : { $or: msgScopeClauses };
      andInto(convSourceFilter, convFilter);
      andInto(msgOwnerFilter, msgFilter);
    }

    // ── Agent filter (dropdown) ─────────────────────────────────────
    // Narrow the whole payload to specific dynamic agents. Keyed per-collection
    // like the owned-agent scope: conversations carry the agent id (Slack), web
    // messages carry the display name. For non-admins the requested ids are
    // intersected with their owned agents so the filter can never widen scope;
    // admins can select any agent. Resolved to {id,name} so both surfaces match.
    let selectedAgents: OwnedAgent[] = [];
    if (agentIds.length > 0) {
      if (nonAdminScope) {
        const ownedById = new Map(nonAdminOwnedAgents.map((a) => [a.id, a]));
        selectedAgents = agentIds.map((id) => ownedById.get(id)).filter((a): a is OwnedAgent => !!a);
      } else {
        selectedAgents = await getAgentsByIds(agentIds);
      }
      const selIds = selectedAgents.map((a) => a.id);
      const selNames = selectedAgents.map((a) => a.name);
      // A requested-but-unresolvable agent set must match nothing, not fall
      // through to the unfiltered payload.
      andInto(convSourceFilter, { 'metadata.thread_owner_agent_id': { $in: selIds } });
      andInto(msgOwnerFilter, { 'metadata.agent_name': { $in: selNames } });
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

    const fbFilter: Document = { created_at: { $gte: rangeStart } };
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
    // Owned agents add a third clause: feedback rows have no agent field, so we
    // match by the conversation_ids routed to those agents (both surfaces).
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
      if (nonAdminOwnedAgents.length > 0) {
        const { ids: ownedConvIds } = await getOwnedAgentConversationIds(nonAdminOwnedAgents);
        if (ownedConvIds.length > 0) {
          fbScope.push({ conversation_id: { $in: ownedConvIds } });
        }
      }
      // Fail-closed: if the caller resolves to no feedback-bearing scope (e.g.
      // owns agents that have produced no conversations, and has no channels or
      // own email), match nothing rather than leaking unscoped feedback.
      if (fbScope.length === 0) fbScope.push({ _id: null });
      andInto(fbFilter, fbScope.length === 1 ? fbScope[0] : { $or: fbScope });
    }

    // Agent-filter the feedback summary the same way: feedback carries no agent
    // field, so match the conversation_ids routed to the selected agents. An
    // empty result must match nothing (the filter was explicitly requested).
    if (selectedAgents.length > 0) {
      const { ids: selectedConvIds } = await getOwnedAgentConversationIds(selectedAgents);
      andInto(fbFilter, { conversation_id: selectedConvIds.length > 0 ? { $in: selectedConvIds } : { $in: [null] } });
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
      webWorkflowEffort,
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

      // Top users by conversations. Bots/service accounts are dropped via
      // HUMAN_OWNER_MATCH unless the caller passed include_bots=true.
      conversations.aggregate([
        { $match: { created_at: { $gte: rangeStart }, ...convSourceFilter } },
        { $group: { _id: '$owner_id', count: { $sum: 1 } } },
        ...topUserOwnerMatch,
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray(),

      // Top users by messages ($lookup for legacy owner_id). Same bot handling.
      messages.aggregate([
        { $match: { created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
        { $lookup: { from: 'conversations', localField: 'conversation_id', foreignField: '_id', as: '_conv' } },
        { $addFields: { _owner: { $ifNull: ['$owner_id', { $arrayElemAt: ['$_conv.owner_id', 0] }] } } },
        { $match: { _owner: { $ne: null } } },
        { $group: { _id: '$_owner', count: { $sum: 1 } } },
        ...topUserOwnerMatch,
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray(),

      // Top agents — dynamic-agent usage across BOTH surfaces, since each records
      // the routed agent in a different place:
      //   • Slack routes per-conversation → conversations.metadata.thread_owner_agent_id
      //     (e.g. "agent-hello-agent")
      //   • Web routes per-message        → messages.metadata.agent_name
      //     (e.g. "Hello Agent")
      // We count DISTINCT conversations per agent on each side (comparable units),
      // humanize both to a common display label, and merge by that label below.
      // 'default'/'Default'/'unknown'/'' are the non-routed fallback, not real agents.
      Promise.all([
        conversations.aggregate([
          { $match: { created_at: { $gte: rangeStart }, 'metadata.thread_owner_agent_id': { $nin: [null, '', 'default', 'unknown'] }, ...convSourceFilter } },
          { $group: { _id: '$metadata.thread_owner_agent_id', count: { $sum: 1 } } },
        ]).toArray(),
        // Count DISTINCT conversations per agent via a two-stage $group
        // (group by agent+conversation, then tally per agent). This avoids
        // $project/$size — DocumentDB supports $group/$sum but not all
        // aggregation expression operators — mirroring the pattern used
        // elsewhere in this route.
        messages.aggregate([
          { $match: { role: 'assistant', 'metadata.agent_name': { $nin: [null, '', 'default', 'Default', 'unknown'] }, created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
          { $group: { _id: { agent: '$metadata.agent_name', conv: '$conversation_id' } } },
          { $group: { _id: '$_id.agent', count: { $sum: 1 } } },
        ]).toArray(),
      ]).then(([slackAgents, webAgents]) => {
        const byLabel = new Map<string, number>();
        for (const row of [...slackAgents, ...webAgents] as Array<{ _id: string; count: number }>) {
          const label = humanizeAgentName(String(row._id));
          byLabel.set(label, (byLabel.get(label) ?? 0) + row.count);
        }
        return [...byLabel.entries()]
          .map(([label, count]) => ({ _id: label, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
      }),

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

      // Web workflow effort for the hours-saved estimate. Each completed web
      // workflow (assistant `is_final` message, non-Slack) stands in for a task
      // the user would otherwise have done by hand; the number of tool calls in
      // its timeline is a cheap proxy for how much work it did. We return the
      // workflow count and the summed tool-call count so the estimate can scale
      // effort by complexity rather than treating every message equally.
      // Single aggregation, no join — cheap.
      sourceFilter !== 'slack'
        ? messages.aggregate([
            { $match: { role: 'assistant', 'metadata.is_final': true, 'metadata.source': { $ne: 'slack' }, created_at: { $gte: rangeStart }, ...msgOwnerFilter } },
            { $addFields: { _toolCalls: { $size: { $filter: { input: { $ifNull: ['$metadata.timeline_segments', []] }, as: 's', cond: { $eq: ['$$s.type', 'tool_call'] } } } } } },
            { $group: { _id: null, workflows: { $sum: 1 }, tool_calls: { $sum: '$_toolCalls' } } },
          ]).toArray().then((r) => r[0] || { workflows: 0, tool_calls: 0 })
        : Promise.resolve({ workflows: 0, tool_calls: 0 }),
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
    let slack: SlackStats | undefined;

    // Slack block channel scope: admins use the `channel` query param; a
    // non-admin is hard-bounded to their readable channels (their web
    // conversations don't appear in this Slack-only section). A non-admin with
    // no readable channels sees no Slack block at all.
    const slackChannelScope = nonAdminScope ? nonAdminChannelNames : channelNames;
    const skipSlackBlock = !!nonAdminScope && nonAdminChannelNames.length === 0;

    try {
      const slackFilter: Document = { ...SLACK_CONV_MATCH, created_at: { $gte: rangeStart } };
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
        const platformConfig = await getCollection<ChannelStatsDocument>('platform_config');

        // Helper: coalesce old slack_meta and new metadata fields
        const userId = { $ifNull: ['$metadata.user_id', '$slack_meta.user_id'] };
        const escalated = { $ifNull: ['$metadata.escalated', '$slack_meta.escalated'] };
        const channelName = { $ifNull: ['$metadata.channel_name', '$slack_meta.channel_name'] };
        const channelId = { $ifNull: ['$metadata.channel_id', '$slack_meta.channel_id'] };
        const interactionType = { $ifNull: ['$metadata.interaction_type', '$slack_meta.interaction_type'] };

        // Self-resolution is only meaningful over threads a human actually
        // started (mention/qanda/dm/user). Automated posts (bot alerts,
        // scheduled-pipeline notifications) aren't questions the assistant
        // "resolved", so counting them made the rate a meaningless ~100%.
        const isUserQuestion = { $in: [interactionType, USER_QUESTION_INTERACTION_TYPES] };

        const channelMappingColl = await getCollection('channel_team_mappings');

        const [configDoc, slackTotal, slackUniqueUsers, slackDailyAgg, slackTopChannels, channelMappings] =
          await Promise.all([
            // Channel config
            platformConfig.findOne({ _id: 'channel_stats' }),
            // Total interactions (threads) in range
            conversations.countDocuments(slackFilter),
            // Unique Slack users
            conversations.aggregate([
              { $match: slackFilter },
              { $group: { _id: userId } },
              { $count: 'total' },
            ]).toArray(),
            // Daily breakdown (user-initiated threads only, to match the rate)
            conversations.aggregate([
              { $match: slackFilter },
              { $addFields: { _isUserQuestion: isUserQuestion, _escalated: escalated } },
              { $match: { _isUserQuestion: true } },
              {
                $group: {
                  _id: { $dateToString: { format: BUCKET_DATE_FORMAT[bucketUnit], date: '$created_at' } },
                  interactions: { $sum: 1 },
                  unique_users: { $addToSet: userId },
                  resolved: { $sum: { $cond: [{ $not: ['$_escalated'] }, 1, 0] } },
                  escalated: { $sum: { $cond: ['$_escalated', 1, 0] } },
                },
              },
              { $sort: { _id: 1 } },
            ]).toArray(),
            // Top channels — group by channel_id (stable) and carry a candidate
            // name; the id→name mapping is resolved after the batch so raw ids
            // like "CFW7VL1GX" don't leak into the UI.
            conversations.aggregate([
              { $match: slackFilter },
              { $addFields: { _channelId: channelId, _channelName: channelName, _isUserQuestion: isUserQuestion, _escalated: escalated } },
              { $match: { _channelId: { $ne: null } } },
              {
                $group: {
                  _id: '$_channelId',
                  // A channel's own metadata.channel_name is the best in-band
                  // name; keep the first non-null we see.
                  name: { $first: '$_channelName' },
                  interactions: { $sum: 1 },
                  resolved: { $sum: { $cond: [{ $and: ['$_isUserQuestion', { $not: ['$_escalated'] }] }, 1, 0] } },
                  user_questions: { $sum: { $cond: ['$_isUserQuestion', 1, 0] } },
                },
              },
              { $sort: { interactions: -1 } },
              { $limit: 10 },
            ]).toArray(),
            // Channel id → human name (authoritative source; covers ids whose
            // conversation metadata only carries the raw id).
            channelMappingColl.find(
              { slack_channel_id: { $ne: null } },
              { projection: { slack_channel_id: 1, channel_name: 1 } },
            ).toArray(),
          ]);

        // Normalize a channel name: strip a leading '#', fall back to null when
        // the "name" is really just the raw id (e.g. name === channel_id).
        const normalizeChannelName = (name: unknown, id: string): string | null => {
          if (typeof name !== 'string' || !name.trim() || name === id) return null;
          return name.replace(/^#/, '').trim();
        };
        const channelNameById = new Map<string, string>();
        for (const m of channelMappings) {
          const clean = normalizeChannelName(m.channel_name, m.slack_channel_id);
          if (m.slack_channel_id && clean) channelNameById.set(m.slack_channel_id, clean);
        }

        // ── Hours-saved estimation (Slack) ─────────────────────────────
        // Only user-initiated threads (mention/qanda/dm/user) count — a
        // bot/alert broadcast didn't save anyone time. Per qualifying thread:
        //   positive feedback                     → 30 min saved
        //   negative feedback OR escalated        → 0    (not actually resolved)
        //   no feedback, not escalated (self-res) → 20 min (conservative)
        // These are intentionally modest, defensible figures rather than the
        // old 4h/thread that produced implausible totals.
        //
        // DocumentDB does not support $lookup with let/pipeline (correlated
        // subqueries), so we fetch conversations and feedback separately and
        // join in application code.
        const POSITIVE_FEEDBACK_MINUTES = 30;
        const SELF_RESOLVED_MINUTES = 20;

        const [slackConvs, slackFeedback] = await Promise.all([
          conversations.find(slackFilter, {
            projection: {
              _id: 1,
              'slack_meta.escalated': 1, 'metadata.escalated': 1,
              'slack_meta.interaction_type': 1, 'metadata.interaction_type': 1,
            },
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
          if (!fbByConv.has(cid)) fbByConv.set(cid, fb.rating);
        }

        // Application-side resolution over user-initiated threads: a thread is
        // "resolved" when it wasn't escalated and wasn't rated negative.
        let userQuestionThreads = 0;
        let resolvedThreadsCount = 0;
        let escalatedThreadsCount = 0;
        let estimatedMinutesSaved = 0;
        for (const conv of slackConvs) {
          const it = conv.metadata?.interaction_type ?? conv.slack_meta?.interaction_type;
          if (!USER_QUESTION_INTERACTION_TYPES.includes(it)) continue;
          userQuestionThreads += 1;

          const rating = fbByConv.get(String(conv._id));
          const escalated = conv.metadata?.escalated ?? conv.slack_meta?.escalated;

          if (escalated) escalatedThreadsCount += 1;

          if (rating === 'negative' || escalated) {
            continue; // not resolved, no time saved
          }
          resolvedThreadsCount += 1;
          estimatedMinutesSaved += rating === 'positive' ? POSITIVE_FEEDBACK_MINUTES : SELF_RESOLVED_MINUTES;
        }
        const estimatedHoursSaved = Math.round((estimatedMinutesSaved / 60) * 10) / 10;

        const resolution = {
          total_threads: userQuestionThreads,
          escalated_threads: escalatedThreadsCount,
        };
        const resolvedThreads = resolvedThreadsCount;
        const resolutionRate = userQuestionThreads > 0
          ? Math.round((resolvedThreads / userQuestionThreads) * 1000) / 10
          : 0;

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
          // Resolve each channel id to a human name: prefer the authoritative
          // channel_team_mappings entry, then the conversation's own
          // metadata.channel_name, and only fall back to the raw id if neither
          // is available. resolution_rate is over the channel's user questions
          // (not all interactions), matching the platform-wide rate.
          top_channels: slackTopChannels.map((c) => {
            const id: string = c._id;
            const resolvedName = channelNameById.get(id) || normalizeChannelName(c.name, id) || id;
            const denom = c.user_questions || 0;
            return {
              channel_name: resolvedName,
              interactions: c.interactions,
              resolved: c.resolved,
              resolution_rate: denom > 0 ? Math.round((c.resolved / denom) * 1000) / 10 : 0,
            };
          }),
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

    // Web hours saved: each completed web workflow stands in for a manual task.
    // We credit a small fixed base per workflow plus a little per tool call it
    // ran (tool calls proxy how much work was automated — a 6-tool
    // investigation saved more time than a one-shot answer). Kept deliberately
    // conservative so the headline number stays defensible.
    const WEB_WORKFLOW_BASE_MINUTES = 5;
    const WEB_PER_TOOL_CALL_MINUTES = 2;
    const webWorkflowStats = webWorkflowEffort as { workflows: number; tool_calls: number };
    const webMinutesSaved = includeWeb
      ? webWorkflowStats.workflows * WEB_WORKFLOW_BASE_MINUTES + webWorkflowStats.tool_calls * WEB_PER_TOOL_CALL_MINUTES
      : 0;
    const webHoursSaved = Math.round((webMinutesSaved / 60) * 10) / 10;

    const slackHoursSaved = includeSlack ? (slack?.resolution?.estimated_hours_saved || 0) : 0;

    const totalHoursAutomated = Math.round((webHoursSaved + slackHoursSaved) * 10) / 10;

    const [oldChannels, newChannels] = availableChannelsResult;
    const availableChannels = nonAdminScope
      ? [...new Set(nonAdminChannelNames)]
      : [...new Set([...oldChannels, ...newChannels])];

    // Agent filter options: a non-admin sees only the agents they own; a full
    // admin sees every dynamic agent. Shape { id, name } so the UI can label by
    // name while filtering by the stable id.
    const availableAgents = (nonAdminScope ? nonAdminOwnedAgents : await getAllAgents())
      .map((a) => ({ id: a.id, name: a.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const platformSummary = {
      satisfaction_rate: feedbackSummary.satisfaction_rate || 0,
      estimated_hours_automated: totalHoursAutomated,
      web_hours_saved: webHoursSaved,
      slack_hours_saved: slackHoursSaved,
      web_workflows: includeWeb ? webWorkflowStats.workflows : 0,
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
      available_agents: availableAgents,
    });
}
