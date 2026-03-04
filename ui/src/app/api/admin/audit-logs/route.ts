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
      {
        $facet: {
          items: [
            { $sort: { updated_at: -1 as const } },
            { $skip: skip },
            { $limit: pageSize },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await conversations.aggregate(pipeline).toArray();
    const items = result?.items || [];
    const total = result?.totalCount?.[0]?.count || 0;

    return paginatedResponse(items, total, page, pageSize);
  });
});
