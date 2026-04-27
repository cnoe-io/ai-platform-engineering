// PATCH /api/admin/users/[email]/role - Update user role

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdmin,
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
    requireAdmin(session);

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

    // Last-admin guard: prevent removing admin when only one admin remains.
    // We check both the users collection (OIDC + synced local users) and
    // local_users (credentials-only accounts) so the count is always accurate.
    if (body.role === 'user' && targetUser.metadata?.role === 'admin') {
      const adminCountInUsers = await users.countDocuments({ 'metadata.role': 'admin' });

      // Count local_users admins that are NOT already in the users collection
      let extraLocalAdmins = 0;
      try {
        const localUsers = await getCollection<{ email: string; role: string }>('local_users');
        const localAdmins = await localUsers
          .find({ role: 'admin' }, { projection: { email: 1 } })
          .toArray();
        // Count credentials admins whose email is NOT in the users collection
        const usersEmails = new Set(
          (await users.find({}, { projection: { email: 1 } }).toArray()).map((u) => u.email)
        );
        extraLocalAdmins = localAdmins.filter((la) => !usersEmails.has(la.email)).length;
      } catch {
        // local_users not available — ignore
      }

      const totalAdmins = adminCountInUsers + extraLocalAdmins;
      if (totalAdmins <= 1) {
        throw new ApiError(
          'Cannot remove the last admin. Promote another user to admin first.',
          409
        );
      }
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

    // Post-update last-admin safety net (compensating transaction).
    // If the update left zero admins — which can happen in a concurrent race —
    // immediately revert and reject. This dramatically reduces (but does not
    // perfectly eliminate) the TOCTOU window on standalone MongoDB deployments.
    if (body.role === 'user') {
      const remainingAdmins = await users.countDocuments({ 'metadata.role': 'admin' });
      if (remainingAdmins === 0) {
        await users.updateOne(
          { email: targetEmail },
          { $set: { 'metadata.role': 'admin', updated_at: new Date() } },
        );
        throw new ApiError(
          'Cannot remove the last admin — another concurrent demotion occurred. Please try again.',
          409,
        );
      }
    }

    console.info(`[Admin] ${user.email} set role of ${targetEmail} to ${body.role}`);

    return successResponse({
      message: `User role updated to ${body.role}`,
      email: targetEmail,
      role: body.role,
    });
  });
});
