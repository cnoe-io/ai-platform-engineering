// PATCH /api/admin/users/[email]/role - Update user role

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from '@/lib/api-middleware';
import type { User } from '@/types/mongodb';

interface UpdateRoleRequest {
  role: 'admin' | 'user';
}

// PATCH /api/admin/users/[email]/role
export const PATCH = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ email: string }> }
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

  return withAuth(request, async (req, user, session) => {
    // Check if requesting user is admin
    if (session.role !== 'admin') {
      throw new ApiError('Admin access required - must be member of admin group', 403);
    }

    const params = await context.params;
    const targetEmail = decodeURIComponent(params.email);
    const body: UpdateRoleRequest = await request.json();

    if (!body.role || !['admin', 'user'].includes(body.role)) {
      throw new ApiError('Invalid role. Must be "admin" or "user"', 400);
    }

    const users = await getCollection<User>('users');
    
    // Find the target user
    const targetUser = await users.findOne({ email: targetEmail });
    
    if (!targetUser) {
      throw new ApiError(`User not found: ${targetEmail}`, 404);
    }

    // Update user role
    const result = await users.updateOne(
      { email: targetEmail },
      {
        $set: {
          'metadata.role': body.role,
          updated_at: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      throw new ApiError(`User not found: ${targetEmail}`, 404);
    }

    console.log(`[Admin] User ${user.email} changed role of ${targetEmail} to ${body.role}`);

    return successResponse({
      message: `User role updated to ${body.role}`,
      email: targetEmail,
      role: body.role,
    });
  });
});
