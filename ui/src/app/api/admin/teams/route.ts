// GET /api/admin/teams - List all teams
// POST /api/admin/teams - Create a new team

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireRbacPermission,
  ApiError,
} from '@/lib/api-middleware';
import {
  deleteTeamClientScope,
  ensureTeamClientScope,
  isValidTeamSlug,
} from '@/lib/rbac/keycloak-admin';

interface CreateTeamRequest {
  name: string;
  slug?: string;
  description?: string;
  members?: string[];
}

/**
 * Derive a Keycloak-safe slug from a team name. Mirrors the rules enforced
 * by `isValidTeamSlug`: lowercase alphanumerics, hyphens, no leading/trailing
 * hyphen, max 63 chars. We deliberately do NOT strip Unicode-to-ASCII (we'd
 * rather fail loudly so the admin notices) — names that produce an empty
 * slug after stripping are rejected with a 400.
 */
function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
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
    await requireRbacPermission(session, 'admin_ui', 'view');

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
    await requireRbacPermission(session, 'admin_ui', 'admin');

    const body: CreateTeamRequest = await request.json();

    if (!body.name || body.name.trim() === '') {
      throw new ApiError('Team name is required', 400);
    }

    const slug = (body.slug?.trim() || deriveSlug(body.name)).toLowerCase();
    if (!slug || !isValidTeamSlug(slug)) {
      throw new ApiError(
        `Could not derive a valid slug from team name "${body.name}". ` +
          `Provide a "slug" explicitly (lowercase letters, digits, hyphens; max 63 chars).`,
        400
      );
    }

    const teams = await getCollection('teams');
    
    // Check if team name already exists
    const existing = await teams.findOne({ name: body.name });
    if (existing) {
      throw new ApiError('Team name already exists', 400);
    }
    const slugConflict = await teams.findOne({ slug });
    if (slugConflict) {
      throw new ApiError(
        `Team slug "${slug}" already in use by team "${slugConflict.name}". ` +
          `Provide a different "slug" in the request.`,
        400
      );
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
      slug,
      description: body.description || '',
      owner_id: user.email,
      created_at: now,
      updated_at: now,
      members,
    };

    const result = await teams.insertOne(team);

    // Materialize the per-team Keycloak client scope BEFORE returning success.
    // If this fails we delete the Mongo doc so we don't leave a team without a
    // scope (which would break OBO token-exchange for that team's channels).
    // We deliberately do NOT swallow the error: the admin needs to see it.
    try {
      await ensureTeamClientScope(slug);
    } catch (err) {
      console.error(
        `[Admin] Failed to create Keycloak client scope for team ${slug}; rolling back Mongo insert:`,
        err
      );
      await teams.deleteOne({ _id: result.insertedId });
      throw new ApiError(
        `Team Keycloak scope provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
        502
      );
    }

    console.log(`[Admin] Team created: ${body.name} (slug=${slug}) by ${user.email}`);

    return successResponse({
      message: 'Team created successfully',
      team_id: result.insertedId,
      team,
    }, 201);
  });
});
