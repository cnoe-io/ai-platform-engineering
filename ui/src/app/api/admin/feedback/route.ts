// GET /api/admin/feedback - Get paginated feedback entries for admin dashboard

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdminView,
} from '@/lib/api-middleware';

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

    const { searchParams } = new URL(req.url);
    const rating = searchParams.get('rating'); // 'positive' | 'negative' | null (all)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const skip = (page - 1) * limit;

    const messages = await getCollection('messages');

    const filter: Record<string, any> = {
      'feedback.rating': { $exists: true },
    };
    if (rating === 'positive' || rating === 'negative') {
      filter['feedback.rating'] = rating;
    }

    const conversations = await getCollection('conversations');

    const [feedbackEntries, totalCount] = await Promise.all([
      messages
        .find(filter, {
          projection: {
            _id: 1,
            message_id: 1,
            conversation_id: 1,
            content: 1,
            role: 1,
            feedback: 1,
            created_at: 1,
            owner_id: 1,
          },
        })
        .sort({ 'feedback.submitted_at': -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      messages.countDocuments(filter),
    ]);

    // Batch-fetch conversation titles for all unique conversation IDs
    const convIds = [...new Set(feedbackEntries.map((m: any) => m.conversation_id).filter(Boolean))];
    const convDocs = convIds.length > 0
      ? await conversations
          .find({ _id: { $in: convIds } }, { projection: { _id: 1, title: 1 } })
          .toArray()
      : [];
    const convTitleMap = new Map(convDocs.map((c: any) => [c._id, c.title]));

    const entries = feedbackEntries.map((msg: any) => ({
      message_id: msg.message_id || msg._id?.toString(),
      conversation_id: msg.conversation_id,
      conversation_title: convTitleMap.get(msg.conversation_id) || undefined,
      content_snippet: typeof msg.content === 'string'
        ? msg.content.slice(0, 200) + (msg.content.length > 200 ? '...' : '')
        : '',
      role: msg.role,
      rating: msg.feedback?.rating,
      reason: msg.feedback?.comment,
      submitted_by: msg.feedback?.submitted_by || msg.owner_id || 'unknown',
      submitted_at: msg.feedback?.submitted_at,
    }));

    return successResponse({
      entries,
      pagination: {
        page,
        limit,
        total: totalCount,
        total_pages: Math.ceil(totalCount / limit),
      },
    });
  });
});
