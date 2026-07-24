// GET /api/admin/feedback - Get paginated feedback entries for admin dashboard
//
// Reads from the unified `feedback` collection (populated by web dual-write,
// Slack bot, and backfill scripts).

import {
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from '@/lib/api-middleware';
import { getConfig } from '@/lib/config';
import { getCollection,isMongoDBConfigured } from '@/lib/mongodb';
import { normLabel } from '@/lib/projects/labels';
import {
resolveAuthorizedAdminSimulationScope,
simulationSubjectCanManageAdminSurface,
} from '@/lib/rbac/admin-simulation-server';
import { resolveInsightsUserFilter } from '@/lib/rbac/insights-user-filter';
import { getOwnedAgentConversationIds, getOwnedAgents, getReadableSlackChannelNames } from '@/lib/rbac/user-insights-scope';
import { getTomeChatSessionsCollection } from '@/lib/tome/mongo-collections';
import type { Conversation } from '@/types/mongodb';
import type { ProjectDocument } from '@/types/projects';
import type { Document,ObjectId } from 'mongodb';
import { NextRequest,NextResponse } from 'next/server';

interface FeedbackDocument extends Document {
  _id?: ObjectId;
  channel_name?: string;
  comment?: string;
  context_url?: string;
  conversation_id?: string;
  created_at?: Date;
  message_id?: string;
  rating?: string;
  report_kind?: string;
  slack_permalink?: string;
  source?: string;
  ticket_id?: string;
  ticket_url?: string;
  tome_project_slug?: string;
  tome_session_id?: string;
  tome_user_question?: string;
  tome_assistant_response?: string;
  trace_id?: string;
  user_email?: string;
  user_id?: string;
  value?: string;
}

const VALUE_LABELS: Record<string, string> = {
  thumbs_up: 'Thumbs up',
  thumbs_down: 'Thumbs down',
  wrong_answer: 'Wrong answer',
  needs_detail: 'Needs detail',
  too_verbose: 'Too verbose',
  retry: 'Retry',
  other: 'Other',
  problem_report: 'Problem report',
  Bug: 'Bug',
  'Confusing UX': 'Confusing UX',
  'Missing feature': 'Missing feature',
  Other: 'Other',
  Trust: 'Trust',
  'Data quality/wrong info': 'Data quality/wrong info',
  "Didn't get answer": "Didn't get answer",
};

// Common English stopwords + product-generic filler words excluded from the
// feedback word cloud so it highlights sentiment-bearing terms.
const WORD_CLOUD_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'this', 'that', 'was',
  'were', 'with', 'have', 'has', 'had', 'from', 'they', 'them', 'their',
  'what', 'when', 'where', 'which', 'who', 'why', 'how', 'can', 'could',
  'would', 'should', 'will', 'just', 'about', 'into', 'than', 'then',
  'its', 'it\'s', 'get', 'got', 'did', 'does', 'doesn\'t', 'don\'t',
  'didn\'t', 'isn\'t', 'wasn\'t', 'aren\'t', 'i\'m', 'i\'ve', 'i\'d',
  'answer', 'response', 'feedback', 'chat', 'question', 'thanks', 'thank',
  'good', 'yes', 'all', 'any', 'more', 'some', 'very', 'much', 'also',
  'been', 'being', 'because', 'here', 'there', 'these', 'those', 'out',
  'off', 'over', 'under', 'again', 'once', 'each', 'few', 'other',
  'such', 'own', 'same', 'too', 'very', 'ok', 'okay',
]);

/** Tokenize free-text feedback comments into lowercase words for the word cloud. */
function tokenizeForWordCloud(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 3 && !WORD_CLOUD_STOPWORDS.has(w) && !/^\d+$/.test(w));
}

interface WordCloudEntry {
  text: string;
  count: number;
}

function buildWordCloud(docs: Array<{ comment?: string }>, maxWords = 40): WordCloudEntry[] {
  const freq = new Map<string, number>();
  for (const doc of docs) {
    if (!doc.comment) continue;
    for (const word of tokenizeForWordCloud(doc.comment)) {
      freq.set(word, (freq.get(word) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, maxWords);
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!getConfig('feedbackEnabled')) {
    return NextResponse.json(
      { success: false, error: 'Feedback feature is not enabled', code: 'FEEDBACK_DISABLED' },
      { status: 404 }
    );
  }

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
    ? await simulationSubjectCanManageAdminSurface(simulationScope, 'feedback')
    : await requireRbacPermission(session, 'admin_ui', 'view').then(
        () => true,
        () => false
      );

  let scopedChannelNames: string[] | null = null;
  let scopedOwnerEmail: string | null = null;
  let scopedOwnedAgentConvIds: string[] | null = null;
  if (!isFullAdmin) {
    const openfgaUser = simulationScope?.openfgaUser ?? (
      typeof session.sub === 'string' && session.sub.trim()
        ? `user:${session.sub.trim()}`
        : ''
    );
    const email = simulationScope?.ownerEmail ?? (
      typeof session.user?.email === 'string' ? session.user.email.trim() : ''
    );
    if (!openfgaUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    const [channelNames, ownedAgents] = await Promise.all([
      getReadableSlackChannelNames(openfgaUser),
      getOwnedAgents(openfgaUser),
    ]);
    scopedChannelNames = channelNames;
    scopedOwnerEmail = email || null;
    // Feedback rows carry no agent field — match owned-agent feedback by the
    // conversation_ids routed to those agents (both Slack and web surfaces).
    scopedOwnedAgentConvIds = ownedAgents.length > 0
      ? (await getOwnedAgentConversationIds(ownedAgents)).ids
      : [];
  }

    const rating = searchParams.get('rating'); // 'positive' | 'negative' | null (all)
    const source = searchParams.get('source'); // 'web' | 'slack' | 'report' | null (all)
    const channel = searchParams.get('channel'); // comma-separated channel names | null (all)
    const userFilter = searchParams.get('user'); // comma-separated user emails | null (all)
    const teamFilter = searchParams.get('team'); // comma-separated team slugs | null (all)
    const { active: hasUserFilter, emails: userEmails } = await resolveInsightsUserFilter(
      userFilter,
      teamFilter,
    );
    const search = searchParams.get('search'); // comma-separated search terms OR'd as regex on comment/value
    const from = searchParams.get('from'); // ISO date string for start of range
    const to = searchParams.get('to'); // ISO date string for end of range
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const skip = (page - 1) * limit;

    // Project attribution filters: project slug, category/initiative name, area name.
    // All three resolve to a set of `tome_project_slug` values in the DB.
    const projectFilterParam = searchParams.get('project'); // comma-separated project slugs
    const categoryFilterParam = searchParams.get('category'); // comma-separated category/initiative names
    const areaFilterParam = searchParams.get('area'); // comma-separated area names
    const hasProjectAttributionFilter = Boolean(projectFilterParam || categoryFilterParam || areaFilterParam);

    const sortByParam = searchParams.get('sortBy');
    const sortDirParam = searchParams.get('sortDir') === 'asc' ? 1 : -1;
    const sortField: string =
      sortByParam === 'rating' ? 'rating'
      : sortByParam === 'source' ? 'source'
      : sortByParam === 'project_slug' ? 'tome_project_slug'
      : 'created_at';

    const feedbackColl = await getCollection<FeedbackDocument>('feedback');

    const filter: Document = {};
    if (rating === 'positive' || rating === 'negative') {
      filter.rating = rating;
    }
    if (source === 'web') {
      filter.source = 'web';
    } else if (source === 'slack') {
      filter.source = 'slack';
      if (channel) {
        const channels = channel.split(',').map((c) => c.trim()).filter(Boolean);
        if (channels.length === 1) {
          filter.channel_name = channels[0];
        } else if (channels.length > 1) {
          filter.channel_name = { $in: channels };
        }
      }
    } else if (source === 'report') {
      filter.source = 'report';
    } else if (source === 'project') {
      filter.source = 'tome';
    }
    if (hasUserFilter) {
      filter.user_email = userEmails.length === 1 ? userEmails[0] : { $in: userEmails };
    }
    if (search) {
      const terms = search.split(',').map((t) => t.trim()).filter(Boolean);
      if (terms.length > 0) {
        // Each term matches comment or value via regex, OR'd together
        filter.$or = terms.flatMap((term) => {
          const regex = { $regex: term, $options: 'i' };
          return [
            { comment: regex },
            { value: regex },
            { tome_user_question: regex },
            { tome_assistant_response: regex },
          ];
        });
      }
    }
    if (from || to) {
      filter.created_at = {};
      if (from) filter.created_at.$gte = new Date(from);
      if (to) filter.created_at.$lte = new Date(to);
    }

    // Resolve Project / Category / Area filters down to a set of tome_project_slug
    // values in the DB. Category (initiative) and Area are project-level labels,
    // not stored on the feedback doc, so we look them up on `projects` first.
    if (hasProjectAttributionFilter) {
      const projectQuery: Document = {};
      const projectSlugs = projectFilterParam
        ? projectFilterParam.split(',').map((s) => s.trim()).filter(Boolean)
        : null;
      const categoryNames = categoryFilterParam
        ? categoryFilterParam.split(',').map((s) => s.trim()).filter(Boolean)
        : null;
      const areaNames = areaFilterParam
        ? areaFilterParam.split(',').map((s) => s.trim()).filter(Boolean)
        : null;
      if (projectSlugs) {
        const escaped = projectSlugs.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        projectQuery.$or = [
          { slug: { $in: projectSlugs } },
          { title: { $in: escaped.map((n) => new RegExp(`^${n}$`, 'i')) } },
          { name: { $in: escaped.map((n) => new RegExp(`^${n}$`, 'i')) } },
        ];
      }
      if (categoryNames) {
        projectQuery['labels.initiatives'] = {
          $in: categoryNames.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')),
        };
      }
      if (areaNames) {
        projectQuery['labels.areas'] = {
          $in: areaNames.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')),
        };
      }
      const projectsColl = await getCollection<ProjectDocument>('projects');
      const matchingSlugs = (
        await projectsColl.find(projectQuery, { projection: { slug: 1 } }).toArray()
      ).map((p) => p.slug);
      // Empty result set must exclude everything, not match everything.
      filter.tome_project_slug = { $in: matchingSlugs.length > 0 ? matchingSlugs : ['__none__'] };
    }

    // Non-admin: scope to their readable Slack channels, their own web feedback,
    // OR feedback on conversations routed to agents they own.
    if (!isFullAdmin) {
      const scopeClauses: Record<string, unknown>[] = [];
      if (scopedChannelNames && scopedChannelNames.length > 0) {
        scopeClauses.push({
          source: 'slack',
          channel_name: scopedChannelNames.length === 1
            ? scopedChannelNames[0]
            : { $in: scopedChannelNames },
        });
      }
      if (scopedOwnerEmail) {
        scopeClauses.push({ user_email: scopedOwnerEmail });
      }
      if (scopedOwnedAgentConvIds && scopedOwnedAgentConvIds.length > 0) {
        scopeClauses.push({ conversation_id: { $in: scopedOwnedAgentConvIds } });
      }
      if (scopeClauses.length === 0) {
        return successResponse({
          entries: [],
          channels: [],
          users: [],
          summary: { positive: 0, negative: 0, total: 0, positive_rate: 0 },
          category_counts: [],
          word_cloud: { positive: [], negative: [] },
          projects: [],
          categories: [],
          areas: [],
          pagination: { page, limit, total: 0, total_pages: 0 },
        });
      }
      if (filter.$or) {
        const existingOr = filter.$or;
        delete filter.$or;
        filter.$and = [{ $or: existingOr }, { $or: scopeClauses }];
      } else {
        filter.$or = scopeClauses;
      }
    }

    const channelDistinctFilter = isFullAdmin
      ? { source: 'slack', channel_name: { $ne: null } }
      : { ...filter, source: 'slack', channel_name: { $ne: null } };
    const userDistinctFilter = isFullAdmin
      ? { user_email: { $ne: null } }
      : { ...filter, user_email: { $ne: null } };

    // Summary counts (positive/negative rate) reflect the same scope + filters
    // as the list, EXCEPT the rating toggle — the rate should describe the whole
    // scoped set, not just the currently-selected rating. RBAC scope, source,
    // channel, user, search, and date filters all still apply.
    const { rating: _omitRating, ...summaryFilter } = filter;
    void _omitRating;

    // Project attribution filter option lists (Project / Category / Area) are computed
    // from the filtered set MINUS the attribution filters themselves, so
    // picking a category doesn't hide the Project/Area options a user might also
    // want to combine with it.
    const { tome_project_slug: _omitTomeProjectSlug, ...optionsBaseFilter } = filter;
    void _omitTomeProjectSlug;

    const [docs, totalCount, channels, distinctUsers, summaryCounts, categoryCountsRaw, wordCloudDocs, optionProjectSlugs] = await Promise.all([
      feedbackColl
        .find(filter)
        .sort({ [sortField]: sortDirParam })
        .skip(skip)
        .limit(limit)
        .toArray(),
      feedbackColl.countDocuments(filter),
      feedbackColl.distinct('channel_name', channelDistinctFilter),
      feedbackColl.distinct('user_email', userDistinctFilter),
      feedbackColl
        .aggregate([
          { $match: summaryFilter },
          { $group: { _id: '$rating', count: { $sum: 1 } } },
        ])
        .toArray(),
      feedbackColl
        .aggregate([
          { $match: summaryFilter },
          { $group: { _id: { value: '$value', rating: '$rating' }, count: { $sum: 1 } } },
        ])
        .toArray(),
      feedbackColl
        .find(summaryFilter, { projection: { comment: 1, rating: 1, _id: 0 } })
        .limit(3000)
        .toArray(),
      feedbackColl.distinct('tome_project_slug', {
        ...optionsBaseFilter,
        tome_project_slug: { $ne: null },
      }),
    ]);

    let positive = 0;
    let negative = 0;
    for (const row of summaryCounts as Array<{ _id: string; count: number }>) {
      if (row._id === 'positive') positive = row.count;
      else if (row._id === 'negative') negative = row.count;
    }

    // Category counts: how many positive/negative ratings each feedback
    // "value" category (Trust, Wrong answer, Bug, ...) received.
    const categoryTotals = new Map<string, { positive: number; negative: number }>();
    for (const row of categoryCountsRaw as Array<{ _id: { value?: string; rating?: string }; count: number }>) {
      const rawValue = row._id?.value;
      const label = (rawValue && VALUE_LABELS[rawValue]) || rawValue || 'Uncategorized';
      const bucket = categoryTotals.get(label) || { positive: 0, negative: 0 };
      if (row._id?.rating === 'positive') bucket.positive += row.count;
      else if (row._id?.rating === 'negative') bucket.negative += row.count;
      categoryTotals.set(label, bucket);
    }
    const categoryCounts = [...categoryTotals.entries()]
      .map(([category, counts]) => ({
        category,
        positive: counts.positive,
        negative: counts.negative,
        total: counts.positive + counts.negative,
      }))
      .sort((a, b) => b.total - a.total);

    const wordCloud = {
      positive: buildWordCloud((wordCloudDocs as Array<{ comment?: string; rating?: string }>).filter((d) => d.rating === 'positive')),
      negative: buildWordCloud((wordCloudDocs as Array<{ comment?: string; rating?: string }>).filter((d) => d.rating === 'negative')),
    };

    // Resolve Project / Category / Area filter option lists from the distinct
    // tome_project_slug values seen in the (attribution-unfiltered) scoped set.
    // The same lookup doubles as the per-entry attribution enrichment map
    // below (current page's docs are always a subset of these slugs).
    let projectOptions: Array<{ slug: string; title: string }> = [];
    let categoryOptions: string[] = [];
    let areaOptions: string[] = [];
    const slugToProjectInfo = new Map<
      string,
      { title: string; domain?: string; categories: string[]; areas: string[] }
    >();
    const optionSlugs = new Set([
      ...(optionProjectSlugs as string[]).filter(Boolean),
      ...docs.flatMap((d) => (d.tome_project_slug ? [d.tome_project_slug] : [])),
    ]);
    if (optionSlugs.size > 0) {
      const projectsColl = await getCollection<ProjectDocument>('projects');
      const projectDocs = await projectsColl
        .find(
          { slug: { $in: [...optionSlugs] } },
          { projection: { slug: 1, title: 1, name: 1, domain: 1, labels: 1 } },
        )
        .toArray();
      const categorySeen = new Map<string, string>();
      const areaSeen = new Map<string, string>();
      projectOptions = projectDocs
        .map((p) => ({ slug: p.slug, title: p.title || p.name || p.slug }))
        .sort((a, b) => a.title.localeCompare(b.title));
      for (const p of projectDocs) {
        const categories = p.labels?.initiatives ?? [];
        const areas = p.labels?.areas ?? [];
        slugToProjectInfo.set(p.slug, {
          title: p.title || p.name || p.slug,
          domain: p.labels?.domain || p.domain,
          categories,
          areas,
        });
        for (const cat of categories) {
          const key = normLabel(cat);
          if (key && !categorySeen.has(key)) categorySeen.set(key, cat);
        }
        for (const area of areas) {
          const key = normLabel(area);
          if (key && !areaSeen.has(key)) areaSeen.set(key, area);
        }
      }
      categoryOptions = [...categorySeen.values()].sort((a, b) => a.localeCompare(b));
      areaOptions = [...areaSeen.values()].sort((a, b) => a.localeCompare(b));
    }
    const summaryTotal = positive + negative;
    const summary = {
      positive,
      negative,
      total: summaryTotal,
      positive_rate: summaryTotal > 0 ? Math.round((positive / summaryTotal) * 100) : 0,
    };

    // For web feedback that has a conversation_id, batch-fetch conversation titles
    const convIds = [...new Set(docs.flatMap((doc) =>
      doc.conversation_id ? [doc.conversation_id] : []
    ))];
    let convTitleMap = new Map<string, string>();
    if (convIds.length > 0) {
      try {
        const conversations = await getCollection<Conversation>('conversations');
        const convDocs = await conversations
          .find({ _id: { $in: convIds } }, { projection: { _id: 1, title: 1 } })
          .toArray();
        convTitleMap = new Map(convDocs.map((conversation) => [conversation._id, conversation.title]));
      } catch {
        // conversations collection may not exist for Slack-only data
      }
    }

    // Legacy Tome feedback was stored as source=web with the tome session uuid
    // in conversation_id. Resolve those rows for correct admin deep-links.
    const legacyTomeSessionIds = [
      ...new Set(
        docs.flatMap((doc) => {
          if (doc.tome_session_id || doc.source === 'slack' || doc.source === 'report') {
            return [];
          }
          if (doc.conversation_id && !convTitleMap.has(doc.conversation_id)) {
            return [doc.conversation_id];
          }
          return [];
        }),
      ),
    ];
    const tomeLinkBySessionId = new Map<
      string,
      { projectSlug: string; sessionId: string }
    >();
    if (legacyTomeSessionIds.length > 0) {
      try {
        const tomeSessions = await getTomeChatSessionsCollection();
        const sessions = await tomeSessions
          .find({ _id: { $in: legacyTomeSessionIds } })
          .toArray();
        const projectIds = [...new Set(sessions.map((s) => s.project_id))];
        const projects = await getCollection<ProjectDocument>('projects');
        const projectDocs = await projects
          .find({ _id: { $in: projectIds as unknown as ProjectDocument['_id'][] } })
          .toArray();
        const slugByProjectId = new Map(
          projectDocs.map((p) => [String(p._id), p.slug]),
        );
        for (const session of sessions) {
          const projectSlug = slugByProjectId.get(String(session.project_id));
          if (projectSlug && session._id) {
            tomeLinkBySessionId.set(session._id, {
              projectSlug,
              sessionId: session._id,
            });
          }
        }
      } catch {
        // Tome collections may be absent on Slack-only deployments
      }
    }

    // Legacy Tome rows resolve to project slugs only at this point (after the
    // main attribution lookup above) — backfill any not already enriched.
    const missingSlugs = [...new Set(
      [...tomeLinkBySessionId.values()]
        .map((link) => link.projectSlug)
        .filter((slug) => slug && !slugToProjectInfo.has(slug)),
    )];
    if (missingSlugs.length > 0) {
      const projectsColl = await getCollection<ProjectDocument>('projects');
      const extraProjectDocs = await projectsColl
        .find(
          { slug: { $in: missingSlugs } },
          { projection: { slug: 1, title: 1, name: 1, domain: 1, labels: 1 } },
        )
        .toArray();
      for (const p of extraProjectDocs) {
        slugToProjectInfo.set(p.slug, {
          title: p.title || p.name || p.slug,
          domain: p.labels?.domain || p.domain,
          categories: p.labels?.initiatives ?? [],
          areas: p.labels?.areas ?? [],
        });
      }
    }

    const entries = docs.map((doc) => {
      const valueLabel = VALUE_LABELS[doc.value] || doc.value || null;
      const comment = doc.comment || null;
      // Combine value and comment: "Wrong answer; check the team..."
      // Skip generic thumbs_up/thumbs_down labels when there's no comment
      const isGenericValue = doc.value === 'thumbs_up' || doc.value === 'thumbs_down';
      let reason: string | null = null;
      if (valueLabel && comment) {
        reason = isGenericValue ? comment : `${valueLabel}; ${comment}`;
      } else if (comment) {
        reason = comment;
      } else if (valueLabel && !isGenericValue) {
        reason = valueLabel;
      }

      return {
        message_id: doc.message_id || doc._id?.toString(),
        conversation_id: doc.conversation_id || null,
        conversation_title: convTitleMap.get(doc.conversation_id) || undefined,
        source:
          doc.source === 'tome' || tomeLinkBySessionId.has(doc.conversation_id || '')
            ? 'project'
            : doc.source || 'web',
        channel_name: doc.channel_name || null,
        rating: doc.rating,
        reason,
        submitted_by: doc.user_email || doc.user_id || 'unknown',
        submitted_at: doc.created_at,
        trace_id: doc.trace_id || null,
        slack_permalink: doc.slack_permalink || null,
        ticket_url: doc.ticket_url || null,
        ticket_id: doc.ticket_id || null,
        context_url: doc.context_url || null,
        report_kind: doc.report_kind || null,
        project_slug:
          doc.tome_project_slug ||
          tomeLinkBySessionId.get(doc.tome_session_id || doc.conversation_id || '')?.projectSlug ||
          null,
        session_id:
          doc.tome_session_id ||
          tomeLinkBySessionId.get(doc.conversation_id || '')?.sessionId ||
          null,
        user_question: doc.tome_user_question || null,
        assistant_response: doc.tome_assistant_response || null,
        project_name: (() => {
          const slug =
            doc.tome_project_slug ||
            tomeLinkBySessionId.get(doc.tome_session_id || doc.conversation_id || '')?.projectSlug;
          return slug ? slugToProjectInfo.get(slug)?.title || null : null;
        })(),
        project_domain: (() => {
          const slug =
            doc.tome_project_slug ||
            tomeLinkBySessionId.get(doc.tome_session_id || doc.conversation_id || '')?.projectSlug;
          return slug ? slugToProjectInfo.get(slug)?.domain || null : null;
        })(),
        categories: (() => {
          const slug =
            doc.tome_project_slug ||
            tomeLinkBySessionId.get(doc.tome_session_id || doc.conversation_id || '')?.projectSlug;
          return slug ? slugToProjectInfo.get(slug)?.categories || [] : [];
        })(),
        areas: (() => {
          const slug =
            doc.tome_project_slug ||
            tomeLinkBySessionId.get(doc.tome_session_id || doc.conversation_id || '')?.projectSlug;
          return slug ? slugToProjectInfo.get(slug)?.areas || [] : [];
        })(),
      };
    });

    return successResponse({
      entries,
      channels: (channels as string[]).sort(),
      users: (distinctUsers as string[]).sort(),
      summary,
      category_counts: categoryCounts,
      word_cloud: wordCloud,
      projects: projectOptions,
      categories: categoryOptions,
      areas: areaOptions,
      pagination: {
        page,
        limit,
        total: totalCount,
        total_pages: Math.ceil(totalCount / limit),
      },
    });
});
