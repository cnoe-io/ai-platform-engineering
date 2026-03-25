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

export const GET = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const mongoCheck = requireMongoDB();
  if (mongoCheck) return mongoCheck;

  return withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const params = await context.params;
    const teamId = parseTeamId(params.id);
    const teams = await getCollection('teams');
    const team = await teams.findOne({ _id: teamId });

    if (!team) {
      throw new ApiError('Team not found', 404);
    }

    const roles = Array.isArray(team.keycloak_roles) ? team.keycloak_roles : [];
    console.log(`[Admin TeamRoles] GET team ${params.id} by ${user.email}`);

    return successResponse({ roles });
  });
});

export const PUT = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const mongoCheck = requireMongoDB();
  if (mongoCheck) return mongoCheck;

  return withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const params = await context.params;
    const teamId = parseTeamId(params.id);
    const body = await request.json();

    if (!body || typeof body !== 'object' || !Array.isArray(body.roles)) {
      throw new ApiError('roles must be an array', 400);
    }
    if (!body.roles.every((r: unknown) => typeof r === 'string')) {
      throw new ApiError('roles must be an array of strings', 400);
    }

    const teams = await getCollection('teams');
    const team = await teams.findOne({ _id: teamId });

    if (!team) {
      throw new ApiError('Team not found', 404);
    }

    const now = new Date();
    await teams.updateOne(
      { _id: teamId },
      { $set: { keycloak_roles: body.roles, updated_at: now } }
    );
    const updated = await teams.findOne({ _id: teamId });

    console.log(`[Admin TeamRoles] PUT team ${params.id} roles=${JSON.stringify(body.roles)} by ${user.email}`);

    return successResponse({ team: updated });
  });
});
