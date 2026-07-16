import {
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from '@/lib/api-middleware';
import { getServerConfig } from '@/lib/config';
import { getCollection,isMongoDBConfigured } from '@/lib/mongodb';
import type { Conversation } from '@/types/mongodb';
import type { Document } from 'mongodb';
import { NextRequest,NextResponse } from 'next/server';

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

  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, 'admin_ui', 'audit.view');

    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim() || '';

    const conversations = await getCollection<Conversation>('conversations');

    const matchStage: Document = {};
    if (q) {
      matchStage.owner_id = { $regex: q, $options: 'i' };
    }

    const pipeline: Document[] = [
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
      { $group: { _id: '$owner_id' } },
      { $sort: { _id: 1 as const } },
      { $limit: 50 },
      { $project: { _id: 0, owner_id: '$_id' } },
    ];

    const results = await conversations.aggregate<{ owner_id?: string }>(pipeline).toArray();
    const owners = results.flatMap((result) => result.owner_id ? [result.owner_id] : []);

    return successResponse({ owners });
});
