// GET /api/admin/teams/[id] - Get team details
// PATCH /api/admin/teams/[id] - Update team name/description
// DELETE /api/admin/teams/[id] - Delete a team

import {
ApiError,
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection,isMongoDBConfigured } from '@/lib/mongodb';
import { requireTeamMembershipManagementPermission } from '@/lib/rbac/team-admin-guards';
import { listTeamMembershipSources } from '@/lib/rbac/team-membership-source-store';
import { listOpenFgaObjects } from '@/lib/rbac/openfga';
import type { UpdateTeamRequest } from '@/types/teams';
import { ObjectId,type Document } from 'mongodb';
import { NextRequest,NextResponse } from 'next/server';

interface TeamDocument extends Document {
  slug?: string;
  name?: string;
}

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

  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, 'team', 'view');

  const params = await context.params;
  const teamId = parseTeamId(params.id);
  const teams = await getCollection<TeamDocument>('teams');
  const team = await teams.findOne({ _id: teamId });

  if (!team) {
    throw new ApiError('Team not found', 404);
  }

  const membershipSources = await listTeamMembershipSources(params.id);

  // NOTE: we deliberately do NOT compute a whole-team OpenFGA sync report
  // here anymore. Doing so read the entire `team:<slug>` tuple set on every
  // team-detail view, which for a team like `everyone` is tens of thousands
  // of tuples — and the old reader silently truncated at 1000, so most
  // members read back as "missing" and showed a false "OpenFGA: drifted"
  // badge. The per-member badge is now computed page-scoped by
  // GET /api/admin/teams/[id]/members (only the visible subjects are read).
  // The accurate post-repair summary is returned by the explicit
  // POST .../openfga/reconcile. `openfga_sync` stays null here so existing
  // consumers keep working without paying the full-scan cost.
  return successResponse({
    team: { ...team, membership_sources: membershipSources },
    membership_sources: membershipSources,
    openfga_sync: null,
  });
});

// PATCH /api/admin/teams/[id]
export const PATCH = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const mongoCheck = requireMongoDB();
  if (mongoCheck) return mongoCheck;

  const { user, session } = await getAuthFromBearerOrSession(request);

  const params = await context.params;
  const teamId = parseTeamId(params.id);
  const body: UpdateTeamRequest = await request.json();

    const teams = await getCollection<TeamDocument>('teams');
    const team = await teams.findOne({ _id: teamId });

    if (!team) {
      throw new ApiError('Team not found', 404);
    }

    // Issue #1509: gate edits behind requireTeamMembershipManagementPermission
    // so scoped team admins (members with role=owner|admin) can rename or
    // update their own team without holding the platform-wide
    // `organization:<org>#admin` tuple. Platform admins still bypass via
    // `admin_ui#admin`.
    await requireTeamMembershipManagementPermission(session, user.email, team);

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

// DELETE /api/admin/teams/[id]
export const DELETE = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const mongoCheck = requireMongoDB();
  if (mongoCheck) return mongoCheck;

  const { user, session } = await getAuthFromBearerOrSession(request);

  const params = await context.params;
  const teamId = parseTeamId(params.id);
  const teams = await getCollection<TeamDocument>('teams');
  const team = await teams.findOne({ _id: teamId });

    if (!team) {
      throw new ApiError('Team not found', 404);
    }

    // Issue #1509: scoped team admins can delete their own team. Platform
    // admins still bypass via `admin_ui#admin`.
    await requireTeamMembershipManagementPermission(session, user.email, team);

    // FR-025 (service accounts): block deletion while the team still owns any
    // service account. Orphaning a service account would leave an
    // unmanageable bot identity (only owning-team members can manage it). The
    // team's members must revoke its service accounts first. OpenFGA is
    // authoritative for ownership: SA tuples are written as
    // `team:<slug>#member owner_team service_account:<sub>`, so list the
    // `service_account` objects this team owns.
    const teamSlug = typeof team.slug === 'string' ? team.slug : '';
    if (teamSlug) {
      let ownedServiceAccounts: string[] = [];
      try {
        const result = await listOpenFgaObjects({
          user: `team:${teamSlug}#member`,
          relation: 'owner_team',
          type: 'service_account',
        });
        ownedServiceAccounts = result.objects;
      } catch (err) {
        // Fail closed: if we cannot confirm there are no owned service
        // accounts, do not risk orphaning one.
        console.error('[Admin] FR-025 service-account ownership check failed:', err);
        throw new ApiError(
          'Unable to verify service-account ownership; team deletion blocked. Please try again.',
          503,
          'SA_OWNERSHIP_CHECK_FAILED',
        );
      }
      if (ownedServiceAccounts.length > 0) {
        throw new ApiError(
          `This team owns ${ownedServiceAccounts.length} service account(s). ` +
            'Revoke them before deleting the team.',
          409,
          'TEAM_OWNS_SERVICE_ACCOUNTS',
        );
      }
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

    // Phase 3 (spec 2026-05-24-derive-team-from-channel): the Keycloak
    // per-team client scope no longer exists, so team deletion is a pure
    // Mongo + OpenFGA operation. The feature was never released, so no
    // realm has stale `team-<slug>` scopes to clean up.
    const slug = typeof team.slug === 'string' ? team.slug : '';

    console.log(`[Admin] Team deleted: ${team.name} (${params.id}, slug=${slug}) by ${user.email}`);

  return successResponse({
    message: 'Team deleted successfully',
    deleted: true,
  });
});
