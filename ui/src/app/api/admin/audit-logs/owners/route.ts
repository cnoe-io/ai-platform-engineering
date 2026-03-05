import { NextRequest, NextResponse } from 'next/server';
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  successResponse,
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

    const url = new URL(req.url);
    const q = url.searchParams.get('q')?.trim() || '';

    const conversations = await getCollection<Conversation>('conversations');

    const matchStage: Record<string, any> = {};
    if (q) {
      matchStage.owner_id = { $regex: q, $options: 'i' };
    }

    const pipeline: any[] = [
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
      { $group: { _id: '$owner_id' } },
      { $sort: { _id: 1 as const } },
      { $limit: 50 },
      { $project: { _id: 0, owner_id: '$_id' } },
    ];

    const results = await conversations.aggregate(pipeline).toArray();
    const owners: string[] = results.map((r: any) => r.owner_id).filter(Boolean);

    return successResponse({ owners });
  });
});
