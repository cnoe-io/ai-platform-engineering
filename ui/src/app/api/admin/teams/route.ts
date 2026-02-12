// GET /api/admin/teams - List all teams
// POST /api/admin/teams - Create a new team

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from '@/lib/api-middleware';

interface CreateTeamRequest {
  name: string;
  description?: string;
  members?: string[];
}

// GET /api/admin/teams
export const GET = withErrorHandler(async (request: NextRequest) => {
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

  return withAuth(request, async (req, user, session) => {
    // Check if user is admin
    if (session.role !== 'admin') {
      throw new ApiError('Admin access required', 403);
    }

    const teams = await getCollection('teams');
    
    const allTeams = await teams
      .find({})
      .sort({ created_at: -1 })
      .toArray();

    return successResponse({
      teams: allTeams,
      total: allTeams.length,
    });
  });
});

// POST /api/admin/teams
export const POST = withErrorHandler(async (request: NextRequest) => {
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

  return withAuth(request, async (req, user, session) => {
    // Check if user is admin
    if (session.role !== 'admin') {
      throw new ApiError('Admin access required', 403);
    }

    const body: CreateTeamRequest = await request.json();

    if (!body.name || body.name.trim() === '') {
      throw new ApiError('Team name is required', 400);
    }

    const teams = await getCollection('teams');
    
    // Check if team name already exists
    const existing = await teams.findOne({ name: body.name });
    if (existing) {
      throw new ApiError('Team name already exists', 400);
    }

    // Create team
    const now = new Date();
    const members = body.members?.map(email => ({
      user_id: email,
      role: 'member',
      added_at: now,
      added_by: user.email,
    })) || [];

    // Add creator as owner
    members.push({
      user_id: user.email,
      role: 'owner',
      added_at: now,
      added_by: user.email,
    });

    const team = {
      name: body.name,
      description: body.description || '',
      owner_id: user.email,
      created_at: now,
      updated_at: now,
      members,
    };

    const result = await teams.insertOne(team);

    console.log(`[Admin] Team created: ${body.name} by ${user.email}`);

    return successResponse({
      message: 'Team created successfully',
      team_id: result.insertedId,
      team,
    }, 201);
  });
});
