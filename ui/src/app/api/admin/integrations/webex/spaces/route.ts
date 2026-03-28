// GET /api/admin/integrations/webex/spaces - List authorized Webex spaces (paginated)
// POST /api/admin/integrations/webex/spaces - Add a new space by room ID

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdmin,
  requireAdminView,
  getPaginationParams,
  paginatedResponse,
  ApiError,
} from '@/lib/api-middleware';
import type { AuthorizedWebexSpace } from '@/types/mongodb';

// GET /api/admin/integrations/webex/spaces
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - Webex spaces require MongoDB',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  return withAuth(request, async (req, _user, session) => {
    requireAdminView(session);

    const { page, pageSize, skip } = getPaginationParams(req);
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get('status') as 'active' | 'revoked' | null;

    const collection = await getCollection<AuthorizedWebexSpace>('authorized_webex_spaces');
    const filter: Record<string, unknown> = {};
    if (statusFilter === 'active' || statusFilter === 'revoked') {
      filter.status = statusFilter;
    }

    const [items, total] = await Promise.all([
      collection
        .find(filter)
        .sort({ authorizedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .toArray(),
      collection.countDocuments(filter),
    ]);

    return paginatedResponse(items, total, page, pageSize);
  });
});

// POST /api/admin/integrations/webex/spaces
export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - Webex spaces require MongoDB',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  return withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const body = await request.json().catch(() => ({}));
    const roomId = (body.roomId ?? body.room_id)?.toString?.()?.trim();
    const spaceName = (body.spaceName ?? body.space_name)?.toString?.()?.trim();

    if (!roomId || roomId.length < 1 || roomId.length > 500) {
      throw new ApiError('roomId is required and must be 1-500 characters', 400, 'VALIDATION_ERROR');
    }

    const collection = await getCollection<AuthorizedWebexSpace>('authorized_webex_spaces');
    const existing = await collection.findOne({ roomId });

    if (existing) {
      if (existing.status === 'active') {
        throw new ApiError('Space is already authorized', 400, 'ALREADY_AUTHORIZED');
      }
      // Re-authorize revoked space
      const now = new Date();
      await collection.updateOne(
        { roomId },
        {
          $set: {
            status: 'active',
            spaceName: spaceName || existing.spaceName,
            authorizedBy: user.email,
            authorizedAt: now,
            revokedAt: undefined,
            revokedBy: undefined,
          },
        }
      );
    } else {
      const now = new Date();
      await collection.insertOne({
        roomId,
        spaceName: spaceName || undefined,
        authorizedBy: user.email,
        authorizedAt: now,
        status: 'active',
      });
    }

    const updated = await collection.findOne({ roomId });
    console.log(`[Webex] Space added by admin: roomId=${roomId} by ${user.email}`);

    return successResponse(
      {
        message: 'Space authorized successfully',
        space: updated,
      },
      201
    );
  });
});
