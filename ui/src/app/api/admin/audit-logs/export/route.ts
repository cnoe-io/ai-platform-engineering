import { NextRequest, NextResponse } from 'next/server';
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
} from '@/lib/api-middleware';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { getServerConfig } from '@/lib/config';
import type { Conversation } from '@/types/mongodb';

const MAX_EXPORT_ROWS = 10000;

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toISOSafe(date: any): string {
  if (!date) return '';
  try {
    return new Date(date).toISOString();
  } catch {
    return '';
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: 'MongoDB not configured', code: 'MONGODB_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  if (!getServerConfig().auditLogsEnabled) {
    return NextResponse.json(
      { success: false, error: 'Audit logs feature is not enabled', code: 'FEATURE_DISABLED' },
      { status: 403 },
    );
  }

  return withAuth(request, async (req, _user, session) => {
    requireAdmin(session);

    const url = new URL(req.url);
    const ownerEmail = url.searchParams.get('owner_email')?.trim();
    const search = url.searchParams.get('search')?.trim();
    const dateFrom = url.searchParams.get('date_from');
    const dateTo = url.searchParams.get('date_to');
    const includeDeleted = url.searchParams.get('include_deleted') === 'true';
    const status = url.searchParams.get('status') as 'active' | 'archived' | 'deleted' | null;

    const matchStage: Record<string, any> = {};

    if (ownerEmail) {
      matchStage.owner_id = { $regex: ownerEmail, $options: 'i' };
    }

    if (search) {
      matchStage.title = { $regex: search, $options: 'i' };
    }

    if (dateFrom || dateTo) {
      matchStage.created_at = {};
      if (dateFrom) matchStage.created_at.$gte = new Date(dateFrom);
      if (dateTo) matchStage.created_at.$lte = new Date(dateTo);
    }

    if (status === 'deleted') {
      matchStage.deleted_at = { $ne: null, $exists: true };
    } else if (status === 'archived') {
      matchStage.is_archived = true;
      if (!includeDeleted) {
        matchStage.$or = [{ deleted_at: null }, { deleted_at: { $exists: false } }];
      }
    } else if (status === 'active') {
      matchStage.is_archived = { $ne: true };
      matchStage.$or = [{ deleted_at: null }, { deleted_at: { $exists: false } }];
    } else if (!includeDeleted) {
      matchStage.$or = [{ deleted_at: null }, { deleted_at: { $exists: false } }];
    }

    const conversations = await getCollection<Conversation>('conversations');

    const pipeline: any[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'messages',
          localField: '_id',
          foreignField: 'conversation_id',
          pipeline: [
            { $sort: { created_at: -1 as const } },
            { $limit: 1 },
            { $project: { created_at: 1 } },
          ],
          as: '_last_msg',
        },
      },
      {
        $addFields: {
          message_count: { $ifNull: ['$metadata.total_messages', 0] },
          last_message_at: { $arrayElemAt: ['$_last_msg.created_at', 0] },
          status: {
            $cond: {
              if: {
                $and: [
                  { $ne: ['$deleted_at', null] },
                  { $ifNull: ['$deleted_at', false] },
                ],
              },
              then: 'deleted',
              else: {
                $cond: {
                  if: { $eq: ['$is_archived', true] },
                  then: 'archived',
                  else: 'active',
                },
              },
            },
          },
        },
      },
      { $project: { _last_msg: 0 } },
      { $sort: { updated_at: -1 as const } },
      { $limit: MAX_EXPORT_ROWS },
    ];

    const items = await conversations.aggregate(pipeline).toArray();

    const header = [
      'Conversation ID',
      'Owner',
      'Title',
      'Status',
      'Messages',
      'Created',
      'Updated',
      'Last Message',
      'Tags',
      'Shared With',
      'Shared With Teams',
      'Is Public',
    ];

    const rows = items.map((conv: any) => [
      escapeCSV(conv._id || ''),
      escapeCSV(conv.owner_id || ''),
      escapeCSV(conv.title || ''),
      escapeCSV(conv.status || ''),
      String(conv.message_count || 0),
      toISOSafe(conv.created_at),
      toISOSafe(conv.updated_at),
      toISOSafe(conv.last_message_at),
      escapeCSV((conv.tags || []).join('; ')),
      escapeCSV((conv.sharing?.shared_with || []).join('; ')),
      escapeCSV((conv.sharing?.shared_with_teams || []).join('; ')),
      String(conv.sharing?.is_public || false),
    ]);

    const csv = [header.join(','), ...rows.map((r: string[]) => r.join(','))].join('\n');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `audit-logs-${timestamp}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  });
});
