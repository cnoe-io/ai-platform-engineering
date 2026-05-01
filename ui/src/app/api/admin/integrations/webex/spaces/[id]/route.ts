// DELETE /api/admin/integrations/webex/spaces/[id] - Revoke authorization for a Webex space

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdmin,
  ApiError,
} from '@/lib/api-middleware';
import type { AuthorizedWebexSpace } from '@/types/mongodb';

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
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

  return withAuth(request, async (_req, user, session) => {
    requireAdmin(session);

    const params = await context.params;
    const id = params.id?.trim();

    if (!id) {
      throw new ApiError('Space ID is required', 400, 'VALIDATION_ERROR');
    }

    const collection = await getCollection<AuthorizedWebexSpace>('authorized_webex_spaces');
    let space: AuthorizedWebexSpace | null;

    if (ObjectId.isValid(id) && id.length === 24) {
      space = await collection.findOne({ _id: new ObjectId(id) });
    } else {
      space = await collection.findOne({ roomId: id });
    }

    if (!space) {
      throw new ApiError('Space not found', 404, 'NOT_FOUND');
    }

    if (space.status === 'revoked') {
      return successResponse({
        message: 'Space is already revoked',
        roomId: space.roomId,
      });
    }

    const now = new Date();
    await collection.updateOne(
      { _id: space._id },
      {
        $set: {
          status: 'revoked',
          revokedAt: now,
          revokedBy: user.email,
        },
      }
    );

    console.log(`[Webex] Space revoked: roomId=${space.roomId} by ${user.email}`);

    return successResponse({
      message: 'Space authorization revoked successfully',
      roomId: space.roomId,
      revokedAt: now,
    });
  });
});
