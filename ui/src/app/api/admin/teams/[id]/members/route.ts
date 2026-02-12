// POST /api/admin/teams/[id]/members - Add members to a team
// DELETE /api/admin/teams/[id]/members - Remove a member from a team

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  validateEmail,
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

// POST /api/admin/teams/[id]/members
export const POST = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const mongoCheck = requireMongoDB();
  if (mongoCheck) return mongoCheck;

  return withAuth(request, async (req, user, session) => {
    if (session.role !== 'admin') {
      throw new ApiError('Admin access required', 403);
    }

    const params = await context.params;
    const teamId = parseTeamId(params.id);
    const body = await request.json();

    if (!body.user_id || typeof body.user_id !== 'string') {
      throw new ApiError('user_id (email) is required', 400);
    }

    const email = body.user_id.trim().toLowerCase();
    if (!validateEmail(email)) {
      throw new ApiError('Invalid email format', 400);
    }

    const role = body.role || 'member';
    if (!['admin', 'member'].includes(role)) {
      throw new ApiError('Role must be "admin" or "member"', 400);
    }

    const teams = await getCollection('teams');
    const team = await teams.findOne({ _id: teamId });

    if (!team) {
      throw new ApiError('Team not found', 404);
    }

    // Check if member already exists
    const existingMember = team.members?.find(
      (m: any) => m.user_id.toLowerCase() === email
    );
    if (existingMember) {
      throw new ApiError('User is already a member of this team', 400);
    }

    const now = new Date();
    const newMember = {
      user_id: email,
      role,
      added_at: now,
      added_by: user.email,
    };

    await teams.updateOne(
      { _id: teamId },
      {
        $push: { members: newMember } as any,
        $set: { updated_at: now },
      }
    );

    const updated = await teams.findOne({ _id: teamId });

    console.log(`[Admin] Member added to team ${team.name}: ${email} (${role}) by ${user.email}`);

    return successResponse({ team: updated }, 201);
  });
});

// DELETE /api/admin/teams/[id]/members
export const DELETE = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const mongoCheck = requireMongoDB();
  if (mongoCheck) return mongoCheck;

  return withAuth(request, async (req, user, session) => {
    if (session.role !== 'admin') {
      throw new ApiError('Admin access required', 403);
    }

    const params = await context.params;
    const teamId = parseTeamId(params.id);
    const url = new URL(request.url);
    const memberEmail = url.searchParams.get('user_id');

    if (!memberEmail) {
      throw new ApiError('user_id query parameter is required', 400);
    }

    const email = memberEmail.trim().toLowerCase();

    const teams = await getCollection('teams');
    const team = await teams.findOne({ _id: teamId });

    if (!team) {
      throw new ApiError('Team not found', 404);
    }

    // Cannot remove the team owner
    if (team.owner_id?.toLowerCase() === email) {
      throw new ApiError('Cannot remove the team owner. Transfer ownership first.', 400);
    }

    // Check if member exists
    const memberExists = team.members?.some(
      (m: any) => m.user_id.toLowerCase() === email
    );
    if (!memberExists) {
      throw new ApiError('User is not a member of this team', 404);
    }

    await teams.updateOne(
      { _id: teamId },
      {
        $pull: { members: { user_id: { $regex: new RegExp(`^${email}$`, 'i') } } } as any,
        $set: { updated_at: new Date() },
      }
    );

    const updated = await teams.findOne({ _id: teamId });

    console.log(`[Admin] Member removed from team ${team.name}: ${email} by ${user.email}`);

    return successResponse({ team: updated });
  });
});
