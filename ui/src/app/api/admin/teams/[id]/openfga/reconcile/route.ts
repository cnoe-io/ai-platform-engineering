// POST /api/admin/teams/[id]/openfga/reconcile
//
// On-demand repair of OpenFGA tuples for a single team. Iterates over the
// active rows in `team_membership_sources`, re-resolves Keycloak subjects
// where missing, then writes any missing `member`/`admin` tuples for
// `team:<slug>`. Idempotent — calling it twice is harmless.
//
// Authorization mirrors POST /api/admin/teams/[id]/members:
//   - Platform admins (admin_ui#admin) can reconcile any team
//   - The team's own admins/owners can reconcile their own team
// Anyone else gets 403. We surface that as a generic
// "You do not have permission to manage this team" to avoid leaking team
// existence to non-members.

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  getAuthFromBearerOrSession,
  withErrorHandler,
  successResponse,
  ApiError,
} from '@/lib/api-middleware';
import { requireTeamMembershipManagementPermission } from '@/lib/rbac/team-admin-guards';
import {
  listTeamMembershipSources,
  upsertTeamMembershipSource,
} from '@/lib/rbac/team-membership-source-store';
import {
  mongoRoleToOpenFgaRelations,
  resolveKeycloakUserSubject,
  writeTeamMembershipTuples,
  type TeamMemberRelation,
} from '@/lib/rbac/team-membership-sync';
import {
  computeTeamMembershipSyncReport,
  readTeamOpenFgaTuples,
} from '@/lib/rbac/team-openfga-sync-status';

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

interface ReconcileSummary {
  attempted: number;
  resolved_subjects: number;
  tuple_writes: number;
  unresolved_emails: string[];
  errors: Array<{ user_email?: string; message: string }>;
}

export const POST = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const mongoCheck = requireMongoDB();
  if (mongoCheck) return mongoCheck;

  const { user, session } = await getAuthFromBearerOrSession(request);
  const params = await context.params;
  const teamId = parseTeamId(params.id);

  const teams = await getCollection('teams');
  const team = await teams.findOne({ _id: teamId });
  if (!team) {
    throw new ApiError('Team not found', 404);
  }

  await requireTeamMembershipManagementPermission(
    session,
    user.email,
    team as { members?: Array<{ user_id?: string; role?: string }> }
  );

  const teamSlug = typeof team.slug === 'string' ? team.slug : '';
  if (!teamSlug) {
    throw new ApiError('Team has no slug — cannot reconcile OpenFGA', 500);
  }

  const sources = await listTeamMembershipSources(params.id);
  const activeSources = sources.filter((s) => s.status === 'active');
  const summary: ReconcileSummary = {
    attempted: activeSources.length,
    resolved_subjects: 0,
    tuple_writes: 0,
    unresolved_emails: [],
    errors: [],
  };

  for (const source of activeSources) {
    const email = source.user_email;
    if (!email) {
      summary.errors.push({
        user_email: undefined,
        message: 'Source row has no user_email; cannot reconcile',
      });
      continue;
    }
    try {
      // Step 1: re-resolve subject. Source rows can outlive the user's
      // first Keycloak login (we persist them when the email→sub lookup
      // returns nothing), so reconcile is the place to retry.
      let userSubject = source.user_subject;
      if (!userSubject) {
        // eslint-disable-next-line no-await-in-loop -- per-user resolution
        userSubject = await resolveKeycloakUserSubject(email, teamSlug);
        if (userSubject) {
          summary.resolved_subjects += 1;
          // Persist the resolved subject back to the source row so future
          // reads of the team show the user as no-longer-pending.
          // eslint-disable-next-line no-await-in-loop
          await upsertTeamMembershipSource({
            ...source,
            user_subject: userSubject,
            last_applied_at: new Date().toISOString(),
          });
        }
      }

      if (!userSubject) {
        summary.unresolved_emails.push(email);
        continue;
      }

      // Step 2: write the OpenFGA tuples implied by the source row. We
      // only write the relation(s) for this row's role — we don't infer
      // a wider role than the source intended.
      const relations: TeamMemberRelation[] = mongoRoleToOpenFgaRelations(
        source.relationship
      );
      if (relations.length === 0) continue;

      // eslint-disable-next-line no-await-in-loop
      const result = await writeTeamMembershipTuples(
        userSubject,
        teamSlug,
        relations,
        'assign'
      );
      if (result.enabled) {
        // The write call is idempotent at the OpenFGA layer — calling
        // assign on an already-present tuple is a no-op. We count what
        // we *attempted* to write so admins see useful telemetry.
        summary.tuple_writes += result.tuples.length;
      }
    } catch (err) {
      summary.errors.push({
        user_email: email,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Recompute the post-reconcile report so the UI can refresh in place.
  const postReport = computeTeamMembershipSyncReport({
    teamSlug,
    sources: await listTeamMembershipSources(params.id),
    tuples: await readTeamOpenFgaTuples(teamSlug),
  });

  console.log(
    `[Admin] Team ${params.id} (slug=${teamSlug}) OpenFGA reconcile by ${user.email}: ` +
      `attempted=${summary.attempted} resolved=${summary.resolved_subjects} ` +
      `writes=${summary.tuple_writes} unresolved=${summary.unresolved_emails.length} ` +
      `errors=${summary.errors.length}`
  );

  return successResponse({
    summary,
    openfga_sync: postReport,
  });
});
