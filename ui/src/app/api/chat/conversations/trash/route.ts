// GET /api/chat/conversations/trash - List soft-deleted conversations (archive)
// Also auto-purges conversations deleted more than 7 days ago

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  paginatedResponse,
  getPaginationParams,
} from '@/lib/api-middleware';
import type { Conversation } from '@/types/mongodb';

const ARCHIVE_RETENTION_DAYS = 7;

// GET /api/chat/conversations/trash
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - use localStorage mode',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  return withAuth(request, async (req, user) => {
    const { page, pageSize, skip } = getPaginationParams(request);
    const conversations = await getCollection<Conversation>('conversations');

    // Auto-purge: permanently delete conversations that have been in the
    // archive for more than 7 days. This runs on every trash listing
    // request as a lightweight cleanup mechanism.
    const purgeThreshold = new Date();
    purgeThreshold.setDate(purgeThreshold.getDate() - ARCHIVE_RETENTION_DAYS);

    const expired = await conversations.find({
      owner_id: user.email,
      deleted_at: { $exists: true, $ne: null, $lte: purgeThreshold },
    }).toArray();

    if (expired.length > 0) {
      const expiredIds = expired.map(c => c._id);
      await conversations.deleteMany({ _id: { $in: expiredIds } });

      // Also delete messages for purged conversations
      const messages = await getCollection('messages');
      await messages.deleteMany({ conversation_id: { $in: expiredIds } });

      console.log(`[Trash] Auto-purged ${expired.length} conversations older than ${ARCHIVE_RETENTION_DAYS} days for ${user.email}`);
    }

    // Query for soft-deleted conversations (have deleted_at set)
    const query = {
      owner_id: user.email,
      deleted_at: { $exists: true, $ne: null },
    };

    const total = await conversations.countDocuments(query);

    const items = await conversations
      .find(query)
      .sort({ deleted_at: -1 }) // Most recently deleted first
      .skip(skip)
      .limit(pageSize)
      .toArray();

    return paginatedResponse(items, total, page, pageSize);
  });
});
