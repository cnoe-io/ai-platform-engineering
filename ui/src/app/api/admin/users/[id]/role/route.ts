import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withErrorHandler,
  successResponse,
  requireRbacPermission,
  ApiError,
  getAuthFromBearerOrSession,
} from '@/lib/api-middleware';
import type { User } from '@/types/mongodb';

interface UpdateRoleRequest {
  role: 'admin' | 'user';
}

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - user management requires MongoDB',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, 'admin_ui', 'admin');

  const params = await context.params;
  const identifier = decodeURIComponent(params.id);
  let body: UpdateRoleRequest;
  try {
    body = (await request.json()) as UpdateRoleRequest;
  } catch {
    throw new ApiError('Invalid JSON body', 400);
  }

  if (!body.role || !['admin', 'user'].includes(body.role)) {
    throw new ApiError('Invalid role. Must be "admin" or "user"', 400);
  }

  const users = await getCollection<User>('users');

  const isEmail = identifier.includes('@');
  const filter = isEmail ? { email: identifier } : { _id: identifier } as Record<string, unknown>;

  const targetUser = await users.findOne(filter);

  if (!targetUser) {
    throw new ApiError(`User not found: ${identifier}`, 404);
  }

  const result = await users.updateOne(
    filter,
    {
      $set: {
        'metadata.role': body.role,
        updated_at: new Date(),
      },
    }
  );

  if (result.matchedCount === 0) {
    throw new ApiError(`User not found: ${identifier}`, 404);
  }

  console.log(`[Admin] User ${user.email} changed role of ${targetUser.email} to ${body.role}`);

  return successResponse({
    message: `User role updated to ${body.role}`,
    email: targetUser.email,
    role: body.role,
  });
});
