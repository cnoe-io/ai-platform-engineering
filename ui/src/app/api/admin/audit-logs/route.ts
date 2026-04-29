import { NextRequest, NextResponse } from 'next/server';
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  getPaginationParams,
  paginatedResponse,
  ApiError,
} from '@/lib/api-middleware';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { getServerConfig } from '@/lib/config';
import type { Conversation } from '@/types/mongodb';

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

    const { page, pageSize, skip } = getPaginationParams(req);
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

    // Count total matching documents (separate query for CosmosDB/DocumentDB compatibility)
    const total = await conversations.countDocuments(matchStage);

    // IMPORTANT: All queries must be compatible with CosmosDB and DocumentDB.
    // Do NOT use $facet or sub-pipeline $lookup (let/pipeline) — they are unsupported.
    const pipeline: any[] = [
      { $match: matchStage },
      {
        $addFields: {
          message_count: { $ifNull: ['$metadata.total_messages', 0] },
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
      { $sort: { updated_at: -1 as const } },
      { $skip: skip },
      { $limit: pageSize },
    ];

    const items: any[] = await conversations.aggregate(pipeline).toArray();

    // Batch-fetch last message timestamps (avoids sub-pipeline $lookup)
    if (items.length > 0) {
      const convIds = items.map((item) => item._id);
      const messages = await getCollection('messages');
      const lastMessages: any[] = await messages
        .aggregate([
          { $match: { conversation_id: { $in: convIds } } },
          { $sort: { created_at: -1 as const } },
          { $group: { _id: '$conversation_id', last_at: { $first: '$created_at' } } },
        ])
        .toArray();
      const lastMsgMap = new Map(lastMessages.map((m) => [m._id, m.last_at]));
      for (const item of items) {
        item.last_message_at = lastMsgMap.get(item._id) || null;
      }
    }

    return paginatedResponse(items, total, page, pageSize);
  });
});
