// POST /api/admin/teams/[id]/members - Add members to a team
// DELETE /api/admin/teams/[id]/members - Remove a member from a team

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  getAuthFromBearerOrSession,
  withErrorHandler,
  successResponse,
  ApiError,
  validateEmail,
} from '@/lib/api-middleware';
import { requireTeamMembershipManagementPermission } from '@/lib/rbac/team-admin-guards';
import {
  listActiveTeamMembershipSourcesForTeamUser,
  markTeamMembershipSourceRemoved,
  upsertTeamMembershipSource,
} from '@/lib/rbac/team-membership-source-store';
import {
  resolveKeycloakUserSubject,
  writeTeamMembershipTuples,
} from '@/lib/rbac/team-membership-sync';
import type { TeamMembershipSource } from '@/types/identity-group-sync';
import type { Team } from '@/types/teams';

type TeamDocument = Omit<Team, '_id'> & { _id: ObjectId };

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

// `resolveKeycloakUserSubject` and `writeTeamMembershipTuples` live in
// `@/lib/rbac/team-membership-sync` so the team-creation route can share the
// exact same email→sub resolution and tuple-write logic. Do not duplicate them
// here.

function manualMembershipSource(input: {
  teamId: string;
  teamSlug: string;
  email: string;
  relationship: 'member' | 'admin';
  actor: string;
  now: Date;
  userSubject?: string;
}): TeamMembershipSource {
  const timestamp = input.now.toISOString();
  return {
    team_id: input.teamId,
    team_slug: input.teamSlug,
    user_subject: input.userSubject,
    user_email: input.email,
    relationship: input.relationship,
    source_type: 'manual',
    managed: false,
    status: 'active',
    first_seen_at: timestamp,
    last_seen_at: timestamp,
    last_applied_at: timestamp,
    created_by: input.actor,
    created_at: timestamp,
  };
}

// POST /api/admin/teams/[id]/members
export const POST = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const mongoCheck = requireMongoDB();
  if (mongoCheck) return mongoCheck;

  const { user, session } = await getAuthFromBearerOrSession(request);
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

    const teams = await getCollection<TeamDocument>('teams');
    const team = await teams.findOne({ _id: teamId });

    if (!team) {
      throw new ApiError('Team not found', 404);
    }
    await requireTeamMembershipManagementPermission(session, user.email, team);

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

    if (!existingMember) {
      await teams.updateOne(
        { _id: teamId },
        {
          $push: { members: newMember } as any,
          $set: { updated_at: now, updated_by: user.email },
        }
      );
    }

    // Sync OpenFGA team membership tuple when the Keycloak subject is known.
    const teamSlug = String(team.slug || "").trim();
    let keycloakSubject: string | undefined;
    if (teamSlug) {
      keycloakSubject = await resolveKeycloakUserSubject(email, teamSlug);
      // POST /members only adds a single relation (member or admin) to the
      // existing team — never both. The team-creation route is the only
      // caller that writes both `admin` and `member` for the creator.
      await writeTeamMembershipTuples(keycloakSubject, teamSlug, [role], 'assign');
      await upsertTeamMembershipSource(
        manualMembershipSource({
          teamId: params.id,
          teamSlug,
          email,
          relationship: role,
          actor: user.email,
          now,
          userSubject: keycloakSubject,
        })
      );
    } else {
      console.warn(
        `[TeamSync] Team ${teamId} has no slug; cannot write OpenFGA membership tuple for ${email}. ` +
        `Restart caipe-ui to trigger backfill via syncTeamScopesOnStartup.`
      );
    }

    const updated = await teams.findOne({ _id: teamId });

    console.log(`[Admin] Member added to team ${team.name}: ${email} (${role}) by ${user.email}`);

  return successResponse({ team: updated }, 201);
});

// DELETE /api/admin/teams/[id]/members
export const DELETE = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const mongoCheck = requireMongoDB();
  if (mongoCheck) return mongoCheck;

  const { user, session } = await getAuthFromBearerOrSession(request);
    const params = await context.params;
    const teamId = parseTeamId(params.id);
    const url = new URL(request.url);
    const memberEmail = url.searchParams.get('user_id');

    if (!memberEmail) {
      throw new ApiError('user_id query parameter is required', 400);
    }

    const email = memberEmail.trim().toLowerCase();

    const teams = await getCollection<TeamDocument>('teams');
    const team = await teams.findOne({ _id: teamId });

    if (!team) {
      throw new ApiError('Team not found', 404);
    }
    await requireTeamMembershipManagementPermission(session, user.email, team);

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

    const now = new Date();
    const teamSlug = String(team.slug || "").trim();
    const member = team.members?.find((m: any) => m.user_id.toLowerCase() === email);
    const relationship = member?.role === 'admin' ? 'admin' : 'member';
    if (teamSlug) {
      await markTeamMembershipSourceRemoved(
        manualMembershipSource({
          teamId: params.id,
          teamSlug,
          email,
          relationship,
          actor: user.email,
          now,
        }),
        user.email,
        now.toISOString()
      );
    }

    const otherActiveSources = teamSlug
      ? await listActiveTeamMembershipSourcesForTeamUser({
          teamId: params.id,
          teamSlug,
          userEmail: email,
          relationship,
        })
      : [];
    const stillGranted = otherActiveSources.some((source) => source.source_type !== 'manual');

    if (!stillGranted) {
      await teams.updateOne(
        { _id: teamId },
        {
          $pull: { members: { user_id: { $regex: new RegExp(`^${email}$`, 'i') } } } as any,
          $set: { updated_at: now, updated_by: user.email },
        }
      );
    }

    // Revoke OpenFGA membership only after the final granting source is gone.
    if (teamSlug) {
      if (!stillGranted) {
        const keycloakSubject = await resolveKeycloakUserSubject(email, teamSlug);
        await writeTeamMembershipTuples(
          keycloakSubject,
          teamSlug,
          [relationship],
          'remove',
        );
      }
    }

    const updated = stillGranted ? team : await teams.findOne({ _id: teamId });

    console.log(`[Admin] Member removed from team ${team.name}: ${email} by ${user.email}`);

  return successResponse({ team: updated });
});
