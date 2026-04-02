// GET/POST /api/admin/integrations/webex/authorize - Authorize a Webex space
// Requires authenticated session. Redirects to login if not authenticated.
// Validates roomId (query for GET, body for POST) and stores the space as authorized.

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  getAuthenticatedUser,
  withErrorHandler,
  successResponse,
  ApiError,
} from '@/lib/api-middleware';
import type { AuthorizedWebexSpace } from '@/types/mongodb';

async function authorizeHandler(request: NextRequest, method: 'GET' | 'POST') {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - Webex authorization requires MongoDB',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  let roomId: string | null;
  if (method === 'GET') {
    const url = new URL(request.url);
    roomId = url.searchParams.get('roomId')?.trim() || null;
  } else {
    const contentType = request.headers.get('content-type') || '';
    let roomIdValue: string | null = null;
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      roomIdValue = (body.roomId ?? body.room_id)?.toString?.()?.trim() || null;
    } else if (contentType.includes('form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await request.formData().catch(() => null);
      if (formData) {
        roomIdValue = (formData.get('roomId') ?? formData.get('room_id'))?.toString?.()?.trim() || null;
      }
    }
    roomId = roomIdValue;
  }

  if (!roomId || roomId.length < 1 || roomId.length > 500) {
    throw new ApiError('roomId is required and must be 1-500 characters', 400, 'VALIDATION_ERROR');
  }

  let user: { email: string; name: string; role: string };
  try {
    const result = await getAuthenticatedUser(request, { allowAnonymous: false });
    user = result.user;
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 401) {
      const baseUrl = request.nextUrl.origin;
      const callbackUrl = `${baseUrl}/api/admin/integrations/webex/authorize?roomId=${encodeURIComponent(roomId)}`;
      const loginUrl = `${baseUrl}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
      return NextResponse.redirect(loginUrl);
    }
    throw err;
  }

  const collection = await getCollection<AuthorizedWebexSpace>('authorized_webex_spaces');
  const now = new Date();

  const existing = await collection.findOne({ roomId });
  if (existing) {
    if (existing.status === 'active') {
      return successResponse({
        message: 'Space already authorized',
        roomId,
        spaceName: existing.spaceName,
        authorizedBy: existing.authorizedBy,
      });
    }
    // Re-authorize a revoked space
    await collection.updateOne(
      { roomId },
      {
        $set: {
          status: 'active',
          authorizedBy: user.email,
          authorizedAt: now,
          revokedAt: undefined,
          revokedBy: undefined,
        },
      }
    );
  } else {
    await collection.insertOne({
      roomId,
      authorizedBy: user.email,
      authorizedAt: now,
      status: 'active',
    });
  }

  const updated = await collection.findOne({ roomId });
  console.log(`[Webex] Space authorized: roomId=${roomId} by ${user.email}`);

  return successResponse({
    message: 'Space authorized successfully',
    roomId,
    spaceName: updated?.spaceName,
    authorizedBy: user.email,
    authorizedAt: now,
  });
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  return authorizeHandler(request, 'GET');
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  return authorizeHandler(request, 'POST');
});
