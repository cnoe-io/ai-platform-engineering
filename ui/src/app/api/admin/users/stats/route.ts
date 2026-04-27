// GET /api/admin/users/stats - Paginated MongoDB users with activity statistics
//
// This endpoint serves the admin analytics view: per-user conversation/message
// counts and last-activity timestamps drawn from MongoDB. It is intentionally
// separate from /api/admin/users (which returns Keycloak identities for RBAC
// management) so each endpoint has a single, focused responsibility:
//
//   /api/admin/users        -> Keycloak (identity, roles, federated IdPs)
//   /api/admin/users/stats  -> MongoDB  (activity rollups, last login, counts)
//
// Tracking concerns and identity management are decoupled; clients that need
// both can call them in parallel and join client-side, or we can add a
// dedicated aggregator endpoint later if many UIs need the joined view.

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireRbacPermission,
} from '@/lib/api-middleware';
import type { User } from '@/types/mongodb';

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - admin features require MongoDB',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  return withAuth(request, async (req, user, session) => {
    // Authorization is handled by Keycloak Authorization Services via the
    // standard `admin_ui#view` permission. Falls back to the `admin` realm
    // role (RESOURCE_ROLE_FALLBACK) when the PDP is unreachable. Legacy
    // signals (MongoDB `users.metadata.role`, OIDC `groups` claim,
    // BOOTSTRAP_ADMIN_EMAILS) are intentionally NOT honored here per the
    // Keycloak-only RBAC policy.
    await requireRbacPermission(session, 'admin_ui', 'view');

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const search = searchParams.get('search')?.trim() || '';
    const skip = (page - 1) * limit;

    const users = await getCollection<User>('users');
    const conversations = await getCollection('conversations');
    const messages = await getCollection('messages');

    const filter: Record<string, any> = {};
    if (search) {
      const regex = { $regex: search, $options: 'i' };
      filter.$or = [{ email: regex }, { name: regex }];
    }

    const [allUsers, totalCount] = await Promise.all([
      users.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).toArray(),
      users.countDocuments(filter),
    ]);

    if (allUsers.length === 0) {
      return successResponse({
        users: [],
        total: totalCount,
        pagination: { page, limit, total: totalCount, total_pages: Math.ceil(totalCount / limit) },
      });
    }

    const emails = allUsers.map((u) => u.email);

    const [convCounts, msgCounts, lastActivities] = await Promise.all([
      conversations.aggregate([
        { $match: { owner_id: { $in: emails } } },
        { $group: { _id: '$owner_id', count: { $sum: 1 } } },
      ]).toArray(),
      messages.aggregate([
        { $match: { owner_id: { $in: emails } } },
        { $group: { _id: '$owner_id', count: { $sum: 1 } } },
      ]).toArray(),
      conversations.aggregate([
        { $match: { owner_id: { $in: emails } } },
        { $group: { _id: '$owner_id', last_activity: { $max: '$updated_at' } } },
      ]).toArray(),
    ]);

    const convMap = new Map(convCounts.map((c) => [c._id, c.count]));
    const msgMap = new Map(msgCounts.map((m) => [m._id, m.count]));
    const activityMap = new Map(lastActivities.map((a) => [a._id, a.last_activity]));

    const usersWithStats = allUsers.map((u) => ({
      email: u.email,
      name: u.name,
      role: u.metadata?.role || 'user',
      created_at: u.created_at,
      last_login: u.last_login,
      last_activity: activityMap.get(u.email) || u.last_login,
      stats: {
        conversations: convMap.get(u.email) || 0,
        messages: msgMap.get(u.email) || 0,
      },
    }));

    return successResponse({
      users: usersWithStats,
      total: totalCount,
      pagination: {
        page,
        limit,
        total: totalCount,
        total_pages: Math.ceil(totalCount / limit),
      },
    });
  });
});
