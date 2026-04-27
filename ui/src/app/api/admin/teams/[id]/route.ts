// GET /api/admin/teams/[id] - Get team details
// PATCH /api/admin/teams/[id] - Update team name/description
// DELETE /api/admin/teams/[id] - Delete a team

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdmin,
  requireRbacPermission,
  ApiError,
} from '@/lib/api-middleware';
import { deleteTeamClientScope } from '@/lib/rbac/keycloak-admin';
import type { UpdateTeamRequest } from '@/types/teams';

function requireMongoDB() {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - teams require MongoDB',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }
  return null;
}

function parseTeamId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new ApiError('Invalid team ID format', 400);
  }
  return new ObjectId(id);
}

// GET /api/admin/teams/[id]
export const GET = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const mongoCheck = requireMongoDB();
  if (mongoCheck) return mongoCheck;

  return withAuth(request, async (req, user, session) => {
    await requireRbacPermission(session, 'admin_ui', 'view');

    const params = await context.params;
    const teamId = parseTeamId(params.id);
    const teams = await getCollection('teams');
    const team = await teams.findOne({ _id: teamId });

    if (!team) {
      throw new ApiError('Team not found', 404);
    }

    return successResponse({ team });
  });
});

// PATCH /api/admin/teams/[id]
export const PATCH = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const mongoCheck = requireMongoDB();
  if (mongoCheck) return mongoCheck;

  return withAuth(request, async (req, user, session) => {
    await requireRbacPermission(session, 'admin_ui', 'admin');
    requireAdmin(session);

    const params = await context.params;
    const teamId = parseTeamId(params.id);
    const body: UpdateTeamRequest = await request.json();

    const teams = await getCollection('teams');
    const team = await teams.findOne({ _id: teamId });

    if (!team) {
      throw new ApiError('Team not found', 404);
    }

    const update: Record<string, any> = { updated_at: new Date() };

    if (body.name !== undefined) {
      if (!body.name.trim()) {
        throw new ApiError('Team name cannot be empty', 400);
      }
      // Check for duplicate name (excluding current team)
      const existing = await teams.findOne({
        name: body.name,
        _id: { $ne: teamId },
      });
      if (existing) {
        throw new ApiError('Team name already exists', 400);
      }
      update.name = body.name.trim();
    }

    if (body.description !== undefined) {
      update.description = body.description;
    }

    await teams.updateOne({ _id: teamId }, { $set: update });
    const updated = await teams.findOne({ _id: teamId });

    console.log(`[Admin] Team updated: ${params.id} by ${user.email}`);

    return successResponse({ team: updated });
  });
});

// DELETE /api/admin/teams/[id]
export const DELETE = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const mongoCheck = requireMongoDB();
  if (mongoCheck) return mongoCheck;

  return withAuth(request, async (req, user, session) => {
    await requireRbacPermission(session, 'admin_ui', 'admin');
    requireAdmin(session);

    const params = await context.params;
    const teamId = parseTeamId(params.id);
    const teams = await getCollection('teams');
    const team = await teams.findOne({ _id: teamId });

    if (!team) {
      throw new ApiError('Team not found', 404);
    }

    // Remove team references from conversations shared_with_teams
    try {
      const conversations = await getCollection('conversations');
      await conversations.updateMany(
        { 'sharing.shared_with_teams': params.id },
        { $pull: { 'sharing.shared_with_teams': params.id } as any }
      );
    } catch (err) {
      console.warn('[Admin] Failed to clean up conversation team references:', err);
    }

    await teams.deleteOne({ _id: teamId });

    // Best-effort delete of the per-team Keycloak client scope. We don't
    // roll the Mongo delete back if this fails — the team is gone, and a
    // dangling scope only matters next time someone reuses the slug
    // (`ensureTeamClientScope` will reuse-and-validate the existing scope).
    // We do log loudly so an operator can clean up.
    const slug = typeof team.slug === 'string' ? team.slug : '';
    if (slug) {
      try {
        await deleteTeamClientScope(slug);
      } catch (err) {
        console.error(
          `[Admin] Team ${params.id} (slug=${slug}) deleted from Mongo but Keycloak scope cleanup failed:`,
          err
        );
      }
    }

    console.log(`[Admin] Team deleted: ${team.name} (${params.id}, slug=${slug}) by ${user.email}`);

    return successResponse({
      message: 'Team deleted successfully',
      deleted: true,
    });
  });
});
