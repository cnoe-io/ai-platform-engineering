import {
  ApiError, getAuthFromBearerOrSession, requireRbacPermission, successResponse, withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { readOpenFgaTuples, writeOpenFgaTuples, type OpenFgaTupleKey } from '@/lib/rbac/openfga';
import { organizationObjectId } from '@/lib/rbac/organization';
import { revokeTeamAutomatorGrants } from '@/lib/rbac/autonomous-cascade';
import { cascadePauseAutonomousTasksForAgents } from '@/lib/dynamic-agents/autonomousTaskCascade';
import { ObjectId } from 'mongodb';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Team autonomous-eligibility. Writes/reads the tuple
 *   team:<slug>#member -> automation_eligible -> organization:<key>
 * Org-admin-only mutation. DELETE cascades (see autonomous-cascade) to revoke the
 * team's per-agent automator grants. Distinct from per-agent automator.
 */
function requireMongoDB(): NextResponse | null {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: 'MongoDB not configured', code: 'MONGODB_NOT_CONFIGURED' },
      { status: 503 },
    );
  }
  return null;
}
interface TeamDoc { _id: ObjectId; slug?: string }
function validateTeamId(id: string): void {
  if (!ObjectId.isValid(id)) throw new ApiError('Invalid team ID format', 400);
}
async function resolveTeamSlug(id: string): Promise<string> {
  const teams = await getCollection('teams');
  const team = (await teams.findOne({ _id: new ObjectId(id) })) as TeamDoc | null;
  if (!team) throw new ApiError('Team not found', 404);
  return (team.slug as string | undefined) || id;
}
export function automationEligibilityTuple(teamSlug: string): OpenFgaTupleKey {
  return { user: `team:${teamSlug}#member`, relation: 'automation_eligible', object: organizationObjectId() };
}
async function teamHoldsEligibility(teamSlug: string): Promise<boolean> {
  const tuple = automationEligibilityTuple(teamSlug);
  const result = await readOpenFgaTuples({ tuple });
  return result.tuples.some(
    (t) => t.key.user === tuple.user && t.key.relation === tuple.relation && t.key.object === tuple.object,
  );
}

export const GET = withErrorHandler(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const mongoCheck = requireMongoDB(); if (mongoCheck) return mongoCheck;
  const { session } = await getAuthFromBearerOrSession(request);
  const params = await context.params; validateTeamId(params.id);
  await requireRbacPermission(session, 'admin_ui', 'view');
  const teamSlug = await resolveTeamSlug(params.id);
  return successResponse({ team_id: params.id, team_slug: teamSlug, automation_eligible: await teamHoldsEligibility(teamSlug) });
});

export const PUT = withErrorHandler(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const mongoCheck = requireMongoDB(); if (mongoCheck) return mongoCheck;
  const { user, session } = await getAuthFromBearerOrSession(request);
  const params = await context.params; validateTeamId(params.id);
  await requireRbacPermission(session, 'admin_ui', 'admin');
  const teamSlug = await resolveTeamSlug(params.id);
  if (!(await teamHoldsEligibility(teamSlug))) {
    const result = await writeOpenFgaTuples({ writes: [automationEligibilityTuple(teamSlug)], deletes: [] });
    if (!result.enabled) throw new ApiError('OpenFGA is not configured; eligibility cannot be granted', 503);
  }
  console.log(`[Admin] Autonomous eligibility GRANTED to team=${teamSlug} by ${user.email}`);
  return successResponse({ team_id: params.id, team_slug: teamSlug, automation_eligible: true });
});

export const DELETE = withErrorHandler(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const mongoCheck = requireMongoDB(); if (mongoCheck) return mongoCheck;
  const { user, session } = await getAuthFromBearerOrSession(request);
  const params = await context.params; validateTeamId(params.id);
  await requireRbacPermission(session, 'admin_ui', 'admin');
  const teamSlug = await resolveTeamSlug(params.id);
  if (await teamHoldsEligibility(teamSlug)) {
    const result = await writeOpenFgaTuples({ writes: [], deletes: [automationEligibilityTuple(teamSlug)] });
    if (!result.enabled) throw new ApiError('OpenFGA is not configured; eligibility cannot be revoked', 503);
  }
  const { count, agentIds } = await revokeTeamAutomatorGrants(teamSlug);
  console.log(`[Admin] Autonomous eligibility REVOKED from team=${teamSlug} by ${user.email} (cascaded ${count} agent grants)`);
  // Best-effort: pause each affected agent's autonomous tasks so they stop
  // firing (and failing) instead of running forever with no visible
  // "paused" state. Never blocks the revoke response -- the live per-run
  // authz check in dynamic-agents already enforces the revocation
  // regardless of whether this cleanup succeeds. Re-granting eligibility
  // does NOT auto-resume these tasks; an operator re-enables them manually.
  if (agentIds.length > 0) {
    await cascadePauseAutonomousTasksForAgents(agentIds).catch((err) =>
      console.warn('[admin] autonomous-task pause cascade failed:', err),
    );
  }
  return successResponse({ team_id: params.id, team_slug: teamSlug, automation_eligible: false, cascaded_agent_grants: count });
});
