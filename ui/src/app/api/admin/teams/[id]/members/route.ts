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
import { findUserRoleInTeam } from '@/lib/rbac/team-membership-store';
import {
  buildTeamMembershipTuples,
  mongoRoleToOpenFgaRelations,
  resolveKeycloakUserSubject,
  writeTeamMembershipTuples,
  type TeamMemberRelation,
} from '@/lib/rbac/team-membership-sync';
import { readTeamOpenFgaTuples } from '@/lib/rbac/team-openfga-sync-status';
import { writeOpenFgaTuples } from '@/lib/rbac/openfga';
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

/**
 * After a manual delete, sweep any OpenFGA tuples on `team:<slug>` whose
 * `user` is the resolved Keycloak subject but no longer corresponds to an
 * active source row. This is the "auto-reconcile with OpenFGA" guarantee
 * for the manual-delete path: clicking Delete in the admin UI never leaves
 * orphan tuples (and therefore never leaves the user as "OpenFGA: drifted"
 * in the team sync report).
 *
 * Idempotent and best-effort:
 *   - If OpenFGA is unreachable or the read fails, `readTeamOpenFgaTuples`
 *     returns `null` and we no-op rather than asserting drift.
 *   - If the user has another active source granting a relation (e.g. an
 *     Okta-synced `member` row), that relation's tuple is preserved.
 */
async function reconcileOrphanOpenFgaTuplesForUser(input: {
  teamId: string;
  teamSlug: string;
  userSubject: string;
  /**
   * Relations already removed by the explicit role-delete in the calling
   * DELETE handler. Excluded from the sweep so we don't issue a redundant
   * OpenFGA delete for tuples the caller already cleared.
   */
  alreadyRemovedRelations?: readonly TeamMemberRelation[];
}): Promise<void> {
  try {
    const tuples = await readTeamOpenFgaTuples(input.teamSlug);
    if (!tuples) return; // unknown — don't infer drift

    const userKey = `user:${input.userSubject}`;
    const tuplesForUser = tuples.filter((t) => t.user === userKey);
    if (tuplesForUser.length === 0) return;

    const remainingSources = await listActiveTeamMembershipSourcesForTeamUser({
      teamId: input.teamId,
      teamSlug: input.teamSlug,
      userSubject: input.userSubject,
    });
    const grantedRelations = new Set<TeamMemberRelation>();
    for (const source of remainingSources) {
      for (const rel of mongoRoleToOpenFgaRelations(source.relationship)) {
        grantedRelations.add(rel);
      }
    }
    const alreadyRemoved = new Set<TeamMemberRelation>(
      input.alreadyRemovedRelations ?? [],
    );

    const orphanRelations: TeamMemberRelation[] = tuplesForUser
      .map((t) => t.relation as TeamMemberRelation)
      .filter((rel) => !grantedRelations.has(rel) && !alreadyRemoved.has(rel));
    if (orphanRelations.length === 0) return;

    const deletes = buildTeamMembershipTuples(
      input.userSubject,
      input.teamSlug,
      orphanRelations,
    );
    const result = await writeOpenFgaTuples({ writes: [], deletes });
    console.log(
      `[Admin] OpenFGA auto-reconcile after delete on team ${input.teamSlug}: ` +
        `cleared ${deletes.length} orphan tuple(s) for user:${input.userSubject} ` +
        `(relations=${orphanRelations.join(',')} enabled=${result.enabled})`,
    );
  } catch (err) {
    // Best-effort: the primary delete already succeeded; an orphan-sweep
    // failure should not turn the DELETE response into a 500.
    console.warn(
      `[Admin] OpenFGA auto-reconcile after delete failed for user:${input.userSubject} ` +
        `team:${input.teamSlug}:`,
      err,
    );
  }
}

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

    // Check if member already exists. Source of truth: canonical
    // team_membership_sources store (post 2026-05-26 canonical-membership
    // refactor). team.members[] is no longer consulted on read.
    const teamSlugForDupeCheck = String(team.slug || "").trim();
    const existingRole = teamSlugForDupeCheck
      ? await findUserRoleInTeam(teamSlugForDupeCheck, { user_email: email })
      : null;
    const existingMember = existingRole !== null;
    if (existingMember) {
      throw new ApiError('User is already a member of this team', 400);
    }

    const now = new Date();

    // Commit 6/8 of the canonical-team-membership refactor (spec
    // 2026-05-26-canonical-team-membership): we no longer $push onto
    // team.members[]. The team_membership_sources upsert below is the
    // sole record of "this user is on this team". We still touch the
    // team document so updated_at/updated_by reflect the mutation —
    // the Admin UI relies on that timestamp for the "last modified"
    // chip on the team card.
    if (!existingMember) {
      await teams.updateOne(
        { _id: teamId },
        { $set: { updated_at: now, updated_by: user.email } },
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

    const now = new Date();
    const teamSlug = String(team.slug || "").trim();

    // Check if member exists; resolve their canonical role for the
    // OpenFGA cleanup below. Source of truth: team_membership_sources
    // (post 2026-05-26 canonical-membership refactor). team.members[]
    // is no longer consulted on read.
    const canonicalRole = teamSlug
      ? await findUserRoleInTeam(teamSlug, { user_email: email })
      : null;
    if (canonicalRole === null) {
      throw new ApiError('User is not a member of this team', 404);
    }
    const relationship: 'admin' | 'member' = canonicalRole;

    // Resolve the Keycloak subject up front. We need it both to mark the
    // manual source row removed by its original `(team_slug, user_subject,
    // relationship, source_type)` key, AND to clean up OpenFGA tuples by
    // `user:<sub>`. We tolerate `undefined` (the source-store filter falls
    // back to user_email; the OpenFGA cleanup is best-effort).
    const keycloakSubject = teamSlug
      ? await resolveKeycloakUserSubject(email, teamSlug)
      : undefined;

    if (teamSlug) {
      await markTeamMembershipSourceRemoved(
        manualMembershipSource({
          teamId: params.id,
          teamSlug,
          email,
          relationship,
          actor: user.email,
          now,
          userSubject: keycloakSubject,
        }),
        user.email,
        now.toISOString()
      );
    }

    const otherActiveSources = teamSlug
      ? await listActiveTeamMembershipSourcesForTeamUser({
          teamId: params.id,
          teamSlug,
          userSubject: keycloakSubject,
          userEmail: email,
        })
      : [];
    const stillGranted = otherActiveSources.some((source) => source.source_type !== 'manual');

    // Commit 6/8 of the canonical-team-membership refactor (spec
    // 2026-05-26-canonical-team-membership): we no longer $pull from
    // team.members[]. The membership-source rows above are the single
    // source of truth — when every non-manual source agrees this user
    // is gone, the canonical store reflects that and the team document
    // only needs its mutation timestamps refreshed.
    if (!stillGranted) {
      await teams.updateOne(
        { _id: teamId },
        { $set: { updated_at: now, updated_by: user.email } },
      );
    }

    // OpenFGA auto-reconcile after manual delete:
    //
    // 1. If no other source still grants membership, delete the specific
    //    `(user, relationship)` tuple we just retired.
    // 2. Sweep any *other* tuples on `team:<slug>` whose `user` is this
    //    Keycloak subject but no longer has a matching active source row.
    //    This catches stale tuples from previous partial failures (e.g. a
    //    bug-era delete that pulled members[] but never marked the source
    //    removed), so an admin clicking Delete in the UI never leaves
    //    "OpenFGA: drifted" residue behind.
    if (teamSlug && keycloakSubject) {
      const alreadyRemovedRelations: TeamMemberRelation[] = [];
      if (!stillGranted) {
        await writeTeamMembershipTuples(
          keycloakSubject,
          teamSlug,
          [relationship],
          'remove',
        );
        alreadyRemovedRelations.push(relationship);
      }
      await reconcileOrphanOpenFgaTuplesForUser({
        teamId: params.id,
        teamSlug,
        userSubject: keycloakSubject,
        alreadyRemovedRelations,
      });
    }

    const updated = stillGranted ? team : await teams.findOne({ _id: teamId });

    console.log(`[Admin] Member removed from team ${team.name}: ${email} by ${user.email}`);

  return successResponse({ team: updated });
});
