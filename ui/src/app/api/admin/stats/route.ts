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
  let nonAdminScope: { channelNames: string[]; ownerEmail: string; ownedAgents: OwnedAgent[]; sub: string } | null = null;
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
    // workflow_runs are owner-keyed by JWT sub (owner_subject.id), not email —
    // openfgaUser is `user:<sub>`, so strip the prefix to recover the raw sub.
    const sub = openfgaUser.startsWith('user:') ? openfgaUser.slice('user:'.length) : '';
    nonAdminScope = { channelNames, ownerEmail: email, ownedAgents, sub };
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
    // Populated after the collections are available (below): a no-op $match
    // spread when bots are included, else a $match that drops bot/service
    // identities — both those detectable by ID pattern (HUMAN_OWNER_MATCH) and
    // Slack bot/app owners flagged at ingestion (metadata.owner_is_bot), whose
    // "U…"-prefixed IDs are indistinguishable from humans.
    let topUserOwnerMatch: Record<string, unknown>[] = [];

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
          response_time: { avg_ms: 0, min_ms: 0, max_ms: 0, sample_count: 0, samples: [] },
          hourly_heatmap: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
          completed_workflows: {
            total: 0,
            today: 0,
            failed: 0,
            completion_rate: 0,
            avg_steps_per_workflow: 0,
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
    const workflowRuns = await getCollection('workflow_runs');

    // Bot/service exclusion for the whole "Top Users" section — the block that
    // spans both Top-Users leaderboards, Top Agents, Response Time, and Activity
    // by Hour. Off when the caller opted into "Show bot users". Otherwise drop:
    //   1. Owners whose ID itself is bot-shaped (HUMAN_OWNER_MATCH / the owner_id
    //      pattern rules below).
    //   2. Slack bot/app owners flagged at ingestion (metadata.owner_is_bot) —
    //      e.g. the GitLab app, whose "U…" user ID looks human. Their owner_ids
    //      are collected here and excluded by value.
    // The Overview cards and activity charts ABOVE the section keep using the
    // unfiltered convSourceFilter/msgOwnerFilter, so the toggle governs only the
    // Top Users section.
    const sectionConvMatch: Document = { ...convSourceFilter };
    const sectionMsgMatch: Document = { ...msgOwnerFilter };
    if (!includeBots) {
      const botOwnerIds = (await conversations.distinct('owner_id', {
        'metadata.owner_is_bot': true,
      })).filter((id): id is string => typeof id === 'string' && id.length > 0);
      // Post-group $match for the leaderboards, which group on owner_id → _id.
      const humanOwnerMatch = botOwnerIds.length > 0
        ? { $and: [HUMAN_OWNER_MATCH, { _id: { $nin: botOwnerIds } }] }
        : HUMAN_OWNER_MATCH;
      topUserOwnerMatch = [{ $match: humanOwnerMatch }];
      // Row-level exclusion for the section's non-grouped aggregations (Top
      // Agents, Response Time, Activity by Hour), which filter documents before
      // grouping. Same rules as HUMAN_OWNER_MATCH but keyed on the owner_id
      // field, plus the ingestion-flagged Slack bot/app owners. Documents with
      // no owner_id (legacy rows) are kept — $nin/$not treat a missing field as
      // a non-match, so only genuine bot owners are dropped.
      const ownerFieldExclusion: Record<string, unknown> = {
        $and: [
          { owner_id: { $nin: BOT_OWNER_EXACT } },
          { owner_id: { $not: /^B[A-Z0-9]{6,}$/ } },
          { owner_id: { $not: /^service-account-/ } },
          ...(botOwnerIds.length > 0 ? [{ owner_id: { $nin: botOwnerIds } }] : []),
        ],
      };
      andInto(sectionConvMatch, ownerFieldExclusion);
      andInto(sectionMsgMatch, ownerFieldExclusion);
    }

    // ── workflow_runs scope ─────────────────────────────────────────
    // The Completed Workflows metric reads the real `workflow_runs` collection
    // (the workflow engine), NOT finished chats. Runs are owner-keyed by JWT
    // sub in `owner_subject.id`, not by email, so this filter is built
    // separately from msgOwnerFilter/convSourceFilter:
    //   - source=slack   → workflows are web-only; match nothing.
    //   - non-admin      → only the caller's own runs (owner_subject.id = sub).
    //   - admin + user=  → resolve the requested emails to Keycloak subs.
    //   - admin, no user → all runs.
    let workflowRunFilter: Document | null = {};
    if (sourceFilter === 'slack') {
      workflowRunFilter = null; // web-only concept; skip the queries entirely
    } else if (nonAdminScope) {
      workflowRunFilter = nonAdminScope.sub
        ? { 'owner_subject.type': 'user', 'owner_subject.id': nonAdminScope.sub }
        : null;
    } else if (userEmails.length > 0) {
      const owners = await users
        .find(
          { email: { $in: userEmails } },
          { projection: { keycloak_sub: 1, 'metadata.keycloak_sub': 1 } },
        )
        .toArray();
      const subs = [
        ...new Set(
          owners
            .map((u) => u.keycloak_sub || u.metadata?.keycloak_sub)
            .filter((s): s is string => typeof s === 'string' && s.length > 0),
        ),
      ];
      workflowRunFilter = subs.length > 0
        ? { 'owner_subject.type': 'user', 'owner_subject.id': { $in: subs } }
        : null; // requested users have no resolvable sub → match nothing
    }

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
      latencyDaily,
      workflowRunAgg,
      completedToday,
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
      // Exclude only empty sentinels ('', null, 'unknown'); the "Default" agent
      // (id 'default') is a real configured dynamic_agent, so it counts.
      Promise.all([
        conversations.aggregate([
          { $match: { created_at: { $gte: rangeStart }, 'metadata.thread_owner_agent_id': { $nin: [null, '', 'unknown'] }, ...sectionConvMatch } },
          { $group: { _id: '$metadata.thread_owner_agent_id', count: { $sum: 1 } } },
        ]).toArray(),
        // Count DISTINCT conversations per agent via a two-stage $group
        // (group by agent+conversation, then tally per agent). This avoids
        // $project/$size — DocumentDB supports $group/$sum but not all
        // aggregation expression operators — mirroring the pattern used
        // elsewhere in this route.
        //
        // Slack messages also carry metadata.agent_name now, but Slack agent
        // usage is counted from conversations.thread_owner_agent_id above — so
        // the messages side must EXCLUDE Slack to avoid double-counting. When
        // the caller explicitly filters source=slack there is no web side at
        // all, so skip this aggregation entirely.
        sourceFilter === 'slack'
          ? Promise.resolve([] as { _id: string; count: number }[])
          : messages.aggregate([
              { $match: { role: 'assistant', 'metadata.source': { $ne: 'slack' }, 'metadata.agent_name': { $nin: [null, '', 'unknown'] }, created_at: { $gte: rangeStart }, ...sectionMsgMatch } },
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

      // Response latency (overall)
      messages.aggregate([
        { $match: { role: 'assistant', 'metadata.latency_ms': { $exists: true, $gt: 0 }, created_at: { $gte: rangeStart }, ...sectionMsgMatch } },
        { $group: { _id: null, avg_latency: { $avg: '$metadata.latency_ms' }, min_latency: { $min: '$metadata.latency_ms' }, max_latency: { $max: '$metadata.latency_ms' }, count: { $sum: 1 } } },
      ]).toArray(),

      // Latency trend, bucketed at the range's granularity (minute/hour/day)
      // so the x-axis scales with the selected window: per-minute for ≤2h,
      // per-hour for ≤1d, per-day beyond. Each bucket carries the MEAN latency
      // of its messages; the UI plots one point per bucket and draws the
      // average line client-side. Same filter as the overall latency stat.
      messages.aggregate([
        { $match: { role: 'assistant', 'metadata.latency_ms': { $exists: true, $gt: 0 }, created_at: { $gte: rangeStart }, ...sectionMsgMatch } },
        { $group: { _id: { $dateToString: { format: BUCKET_DATE_FORMAT[bucketUnit], date: '$created_at' } }, avg_latency: { $avg: '$metadata.latency_ms' } } },
      ]).toArray(),

      // Completed Workflows metric — real workflow-engine runs (workflow_runs
      // collection), NOT finished chats. A "workflow" is one document in
      // workflow_runs; "completed"/"failed" come from its `status`. Range is
      // keyed on `started_at` (the only always-present timestamp). Returns
      // total runs, completed, failed (failed+cancelled), and — over completed
      // runs only — the step count needed for the avg-steps card.
      // `workflowRunFilter` is null when this scope produces no runs (Slack-only
      // view, or a user filter that resolves to no subject), so the metric is 0.
      workflowRunFilter
        ? workflowRuns.aggregate([
            { $match: { started_at: { $gte: rangeStart }, ...workflowRunFilter } },
            { $group: {
              _id: null,
              total_runs: { $sum: 1 },
              completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'cancelled']] }, 1, 0] } },
              completed_steps: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, { $size: { $ifNull: ['$steps', []] } }, 0] } },
            } },
          ]).toArray()
        : Promise.resolve([]),

      // Completed workflows today — runs that reached `completed` today.
      workflowRunFilter
        ? workflowRuns.countDocuments({ status: 'completed', completed_at: { $gte: today }, ...workflowRunFilter })
        : Promise.resolve(0),

      // Hourly heatmap — msgOwnerFilter already carries metadata.source
      // when source=web|slack was explicitly requested; unfiltered, this
      // counts every message regardless of metadata.source.
      messages.aggregate([
        { $match: { created_at: { $gte: rangeStart }, ...sectionMsgMatch } },
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

    // Latency trend points, oldest→newest, one per non-empty bucket. `ts` is
    // the bucket key ($dateToString format), which formatBucketLabel renders
    // as a date for day buckets ("Jul 20") and a time for hour/minute buckets
    // ("10:00 AM"). Empty buckets are omitted rather than plotted as 0ms so the
    // client-side average line reflects only real samples. Ordered by bucket
    // key, which is lexicographically chronological for every granularity.
    const latencyByBucket = new Map<string, number>(
      latencyDaily.map((s) => [String(s._id), Math.round(s.avg_latency)]),
    );
    const latencySamples = generateBucketKeys(now, bucketCount, bucketUnit)
      .filter((key) => latencyByBucket.has(key))
      .map((key) => ({ ts: key, latency_ms: latencyByBucket.get(key)! }));

    const responseTime = latencyAgg[0]
      ? {
          avg_ms: Math.round(latencyAgg[0].avg_latency),
          min_ms: latencyAgg[0].min_latency,
          max_ms: latencyAgg[0].max_latency,
          sample_count: latencyAgg[0].count,
          samples: latencySamples,
        }
      : { avg_ms: 0, min_ms: 0, max_ms: 0, sample_count: 0, samples: [] };

    // Completed Workflows — derived from workflow_runs (see the aggregation
    // above). completion_rate = completed / total runs; avg_steps is over
    // completed runs only.
    const wfRun = workflowRunAgg[0] || { total_runs: 0, completed: 0, failed: 0, completed_steps: 0 };
    const totalRuns = wfRun.total_runs || 0;
    const completedCount = wfRun.completed || 0;
    const completedTodayCount = completedToday || 0;
    const failedCount = wfRun.failed || 0;
    const completionRate = totalRuns > 0
      ? Math.round((completedCount / totalRuns) * 1000) / 10
      : 0;
    const avgStepsCompleted = completedCount > 0
      ? Math.round((wfRun.completed_steps / completedCount) * 10) / 10
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
      // Agent filter applies to the Slack block too: Slack conversations carry
      // the routed agent on metadata.thread_owner_agent_id, so scope by the
      // selected agent ids to keep this section consistent with the rest of the
      // page (Overview, Top Users, Top Agents, etc.).
      if (selectedAgents.length > 0) {
        andInto(slackFilter, {
          'metadata.thread_owner_agent_id': { $in: selectedAgents.map((a) => a.id) },
        });
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
        // A non-originator human replying in the thread means the asker did not
        // self-serve — a colleague stepped in. The Slack bot sets this flag when
        // it observes a thread reply from anyone other than the thread's
        // originator (originator↔bot back-and-forth stays self-resolved).
        const humanAssisted = { $ifNull: ['$metadata.human_assisted', false] };
        // A thread is NOT self-resolved when it was escalated to a human or a
        // non-originator human assisted. (Negative feedback is applied per-thread
        // in the app-side loop below, where the rating join lives.)
        const unresolved = { $or: [escalated, humanAssisted] };

        // Self-resolution is only meaningful over threads a human actually
        // started (mention/qanda/dm/user). Automated posts (bot alerts,
        // scheduled-pipeline notifications) aren't questions the assistant
        // "resolved", so counting them made the rate a meaningless ~100%.
        const isUserQuestion = { $in: [interactionType, USER_QUESTION_INTERACTION_TYPES] };

        const channelMappingColl = await getCollection<{
          slack_channel_id?: string;
          channel_name?: string;
          created_at?: string | Date;
          active?: boolean;
        }>('channel_team_mappings');

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
              { $addFields: { _isUserQuestion: isUserQuestion, _escalated: escalated, _unresolved: unresolved } },
              { $match: { _isUserQuestion: true } },
              {
                $group: {
                  _id: { $dateToString: { format: BUCKET_DATE_FORMAT[bucketUnit], date: '$created_at' } },
                  interactions: { $sum: 1 },
                  unique_users: { $addToSet: userId },
                  resolved: { $sum: { $cond: [{ $not: ['$_unresolved'] }, 1, 0] } },
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
              { $addFields: { _channelId: channelId, _channelName: channelName, _isUserQuestion: isUserQuestion, _unresolved: unresolved } },
              { $match: { _channelId: { $ne: null } } },
              {
                $group: {
                  _id: '$_channelId',
                  // A channel's own metadata.channel_name is the best in-band
                  // name; keep the first non-null we see.
                  name: { $first: '$_channelName' },
                  interactions: { $sum: 1 },
                  resolved: { $sum: { $cond: [{ $and: ['$_isUserQuestion', { $not: ['$_unresolved'] }] }, 1, 0] } },
                  user_questions: { $sum: { $cond: ['$_isUserQuestion', 1, 0] } },
                },
              },
              { $sort: { interactions: -1 } },
              { $limit: 10 },
            ]).toArray(),
            // Channel id → human name (authoritative source; covers ids whose
            // conversation metadata only carries the raw id). Also carries
            // created_at + active for the "configured channels" stat/timeline.
            // Non-admins only ever see their readable channels here.
            channelMappingColl.find(
              {
                slack_channel_id: { $ne: null },
                ...(nonAdminScope && nonAdminChannelNames.length > 0
                  ? { channel_name: { $in: nonAdminChannelNames } }
                  : {}),
              },
              { projection: { slack_channel_id: 1, channel_name: 1, created_at: 1, active: 1 } },
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

        // ── Configured channels: count + cumulative timeline ───────────
        // How many Slack channels are wired to a team (active mappings), and
        // how that total grew over the selected range. Distinct by channel id
        // so a re-mapped channel isn't double-counted. Timeline is cumulative:
        // each bucket is the running total of channels configured on/before it,
        // seeded with those configured before the range start.
        const activeMappings = channelMappings.filter((m) => m.active !== false && m.slack_channel_id);
        const configuredChannelsTotal = new Set(activeMappings.map((m) => m.slack_channel_id)).size;

        const configuredBeforeRange = new Set<string>();
        const configuredByBucket = new Map<string, Set<string>>();
        for (const m of activeMappings) {
          const created = m.created_at ? new Date(m.created_at) : null;
          if (!created || Number.isNaN(created.getTime()) || created < rangeStart) {
            // No timestamp (legacy) or configured before the window → part of
            // the starting baseline rather than growth inside the range.
            configuredBeforeRange.add(m.slack_channel_id);
            continue;
          }
          const key = bucketDateKey(floorToBucket(created, bucketUnit), bucketUnit);
          if (!configuredByBucket.has(key)) configuredByBucket.set(key, new Set());
          configuredByBucket.get(key)!.add(m.slack_channel_id);
        }
        let runningConfigured = configuredBeforeRange.size;
        const configuredChannelsDaily = generateBucketKeys(now, bucketCount, bucketUnit).map((dateKey) => {
          runningConfigured += configuredByBucket.get(dateKey)?.size ?? 0;
          return { date: dateKey, total: runningConfigured };
        });

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
              'metadata.human_assisted': 1,
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
        // "resolved" (self-served) only when it wasn't escalated, wasn't rated
        // negative, and no non-originator human replied. A non-originator human
        // (metadata.human_assisted) means a colleague stepped in, so it doesn't
        // count as self-service; originator↔bot back-and-forth still does.
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
          const humanAssisted = conv.metadata?.human_assisted === true;

          if (escalated) escalatedThreadsCount += 1;

          if (rating === 'negative' || escalated || humanAssisted) {
            continue; // not self-resolved, no time saved
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
          configured_channels: configuredChannelsTotal,
          configured_channels_daily: configuredChannelsDaily,
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

    // Hours saved — two independent web signals plus Slack:
    //   1. Agent chats: each tool call an agent ran in a completed chat proxies
    //      a small manual step it did for the user (~seconds each).
    //   2. Workflow runs: each completed step in a completed workflow_runs run
    //      stands in for a manual task the automation performed (~minutes each).
    // Kept deliberately conservative so the headline number stays defensible.
    const AGENT_PER_TOOL_CALL_SECONDS = 5;
    const WORKFLOW_PER_STEP_MINUTES = 5;
    const webWorkflowStats = webWorkflowEffort as { workflows: number; tool_calls: number };
    const agentSecondsSaved = includeWeb ? webWorkflowStats.tool_calls * AGENT_PER_TOOL_CALL_SECONDS : 0;
    const agentHoursSaved = Math.round((agentSecondsSaved / 3600) * 10) / 10;
    // wfRun.completed_steps = total steps across completed runs (see the
    // Completed Workflows aggregation above); it already respects the range,
    // owner, and source scope. Slack-only views set workflowRunFilter=null → 0.
    const workflowMinutesSaved = includeWeb ? (wfRun.completed_steps || 0) * WORKFLOW_PER_STEP_MINUTES : 0;
    const workflowHoursSaved = Math.round((workflowMinutesSaved / 60) * 10) / 10;
    const webHoursSaved = Math.round((agentHoursSaved + workflowHoursSaved) * 10) / 10;

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
      agent_hours_saved: agentHoursSaved,
      workflow_hours_saved: workflowHoursSaved,
      slack_hours_saved: slackHoursSaved,
      // Real completed workflow_runs in scope (drives the tooltip breakdown).
      web_workflows: includeWeb ? completedCount : 0,
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
        failed: failedCount,
        completion_rate: completionRate,
        avg_steps_per_workflow: avgStepsCompleted,
      },
      ...(slack ? { slack } : {}),
      available_channels: availableChannels.sort(),
      available_agents: availableAgents,
    });
}
