// GET /api/admin/feedback - Get paginated feedback entries for admin dashboard
//
// Reads from the unified `feedback` collection (populated by web dual-write,
// Slack bot, and backfill scripts).

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { getConfig } from '@/lib/config';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireRbacPermission,
} from '@/lib/api-middleware';

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

  return withAuth(request, async (req, user, session) => {
    await requireRbacPermission(session, 'admin_ui', 'view');

    const { searchParams } = new URL(req.url);
    const rating = searchParams.get('rating'); // 'positive' | 'negative' | null (all)
    const source = searchParams.get('source'); // 'web' | 'slack' | null (all)
    const channel = searchParams.get('channel'); // comma-separated channel names | null (all)
    const userFilter = searchParams.get('user'); // comma-separated user emails | null (all)
    const search = searchParams.get('search'); // comma-separated search terms OR'd as regex on comment/value
    const from = searchParams.get('from'); // ISO date string for start of range
    const to = searchParams.get('to'); // ISO date string for end of range
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const skip = (page - 1) * limit;

    const feedbackColl = await getCollection('feedback');

    const filter: Record<string, any> = {};
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
    }
    if (userFilter) {
      const users = userFilter.split(',').map((u) => u.trim()).filter(Boolean);
      if (users.length === 1) {
        filter.user_email = users[0];
      } else if (users.length > 1) {
        filter.user_email = { $in: users };
      }
    }
    if (search) {
      const terms = search.split(',').map((t) => t.trim()).filter(Boolean);
      if (terms.length > 0) {
        // Each term matches comment or value via regex, OR'd together
        filter.$or = terms.flatMap((term) => {
          const regex = { $regex: term, $options: 'i' };
          return [{ comment: regex }, { value: regex }];
        });
      }
    }
    if (from || to) {
      filter.created_at = {};
      if (from) filter.created_at.$gte = new Date(from);
      if (to) filter.created_at.$lte = new Date(to);
    }

    const [docs, totalCount, channels, distinctUsers] = await Promise.all([
      feedbackColl
        .find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      feedbackColl.countDocuments(filter),
      feedbackColl.distinct('channel_name', { source: 'slack', channel_name: { $ne: null } }),
      feedbackColl.distinct('user_email', { user_email: { $ne: null } }),
    ]);

    // For web feedback that has a conversation_id, batch-fetch conversation titles
    const convIds = [...new Set(
      docs.map((d: any) => d.conversation_id).filter(Boolean)
    )];
    let convTitleMap = new Map<string, string>();
    if (convIds.length > 0) {
      try {
        const conversations = await getCollection('conversations');
        const convDocs = await conversations
          .find({ _id: { $in: convIds } }, { projection: { _id: 1, title: 1 } })
          .toArray();
        convTitleMap = new Map(convDocs.map((c: any) => [c._id, c.title]));
      } catch {
        // conversations collection may not exist for Slack-only data
      }
    }

    const VALUE_LABELS: Record<string, string> = {
      thumbs_up: 'Thumbs up',
      thumbs_down: 'Thumbs down',
      wrong_answer: 'Wrong answer',
      needs_detail: 'Needs detail',
      too_verbose: 'Too verbose',
      retry: 'Retry',
      other: 'Other',
    };

    const entries = docs.map((doc: any) => {
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
        source: doc.source || 'web',
        channel_name: doc.channel_name || null,
        rating: doc.rating,
        reason,
        submitted_by: doc.user_email || doc.user_id || 'unknown',
        submitted_at: doc.created_at,
        trace_id: doc.trace_id || null,
        slack_permalink: doc.slack_permalink || null,
      };
    });

    return successResponse({
      entries,
      channels: (channels as string[]).sort(),
      users: (distinctUsers as string[]).sort(),
      pagination: {
        page,
        limit,
        total: totalCount,
        total_pages: Math.ceil(totalCount / limit),
      },
    });
  });
});
