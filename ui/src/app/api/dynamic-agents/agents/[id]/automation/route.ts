import {
  ApiError, getAuthFromBearerOrSession, successResponse, withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection } from '@/lib/mongodb';
import { requireTeamMembershipManagementPermission } from '@/lib/rbac/team-admin-guards';
import { readOpenFgaTuples, writeOpenFgaTuples, type OpenFgaTupleKey } from '@/lib/rbac/openfga';
import { organizationObjectId } from '@/lib/rbac/organization';
import { NextRequest } from 'next/server';

/**
 * Per-agent autonomous enablement for a team.
 * Writes/deletes  team:<slug>#member -> automator -> agent:<id>.
 * PUT/DELETE require the caller to be a platform admin or an admin of the
 * agent's owner team — agent-level can_manage is NOT enough, because the
 * team "Manage" grant extends it to every member and per-agent autonomous
 * enablement is a team-admin decision (Layer 2). PUT additionally requires
 * the team to hold Layer 1 eligibility (automation_eligible on the org).
 * can_schedule = automator and can_use.
 */
export function agentAutomatorTuple(agentId: string, teamSlug: string): OpenFgaTupleKey {
  return { user: `team:${teamSlug}#member`, relation: 'automator', object: `agent:${agentId}` };
}
function eligibilityTuple(teamSlug: string): OpenFgaTupleKey {
  return { user: `team:${teamSlug}#member`, relation: 'automation_eligible', object: organizationObjectId() };
}
async function hasTuple(t: OpenFgaTupleKey): Promise<boolean> {
  const result = await readOpenFgaTuples({ tuple: t });
  return result.tuples.some((r) => r.key.user === t.user && r.key.relation === t.relation && r.key.object === t.object);
}
async function readTeamSlug(request: NextRequest): Promise<string> {
  const body = (await request.json().catch(() => ({}))) as { team_slug?: unknown };
  const slug = typeof body.team_slug === 'string' ? body.team_slug.trim() : '';
  if (!slug) throw new ApiError('team_slug is required', 400);
  return slug;
}
async function requireAgentOwnerTeam(agentId: string, requestedTeamSlug: string): Promise<string> {
  const agents = await getCollection<{ _id: string; owner_team_slug?: unknown }>('dynamic_agents');
  const agent = await agents.findOne(
    { _id: agentId },
    { projection: { owner_team_slug: 1 } },
  ) as { owner_team_slug?: unknown } | null;
  if (!agent) throw new ApiError('Agent not found', 404);
  const ownerTeamSlug = typeof agent.owner_team_slug === 'string' ? agent.owner_team_slug.trim() : '';
  if (!ownerTeamSlug) {
    throw new ApiError('This agent has no owner team; autonomous scheduling requires an owner team.', 409);
  }
  if (requestedTeamSlug !== ownerTeamSlug) {
    throw new ApiError('Autonomous scheduling can only be enabled for the agent owner team.', 403);
  }
  return ownerTeamSlug;
}

export const PUT = withErrorHandler(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  const { id } = await context.params;
  const requestedTeamSlug = await readTeamSlug(request);
  const teamSlug = await requireAgentOwnerTeam(id, requestedTeamSlug);
  await requireTeamMembershipManagementPermission(session, user?.email, { slug: teamSlug });
  if (!(await hasTuple(eligibilityTuple(teamSlug)))) {
    throw new ApiError(
      'This team is not autonomous-eligible. A platform admin must enable autonomous for the team first.',
      409, 'TEAM_NOT_AUTOMATION_ELIGIBLE',
    );
  }
  const tuple = agentAutomatorTuple(id, teamSlug);
  if (!(await hasTuple(tuple))) {
    const result = await writeOpenFgaTuples({ writes: [tuple], deletes: [] });
    if (!result.enabled) throw new ApiError('OpenFGA is not configured; cannot enable autonomous', 503);
  }
  return successResponse({ agent_id: id, team_slug: teamSlug, autonomous_enabled: true });
});

export const DELETE = withErrorHandler(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  const { id } = await context.params;
  const requestedTeamSlug = await readTeamSlug(request);
  const teamSlug = await requireAgentOwnerTeam(id, requestedTeamSlug);
  await requireTeamMembershipManagementPermission(session, user?.email, { slug: teamSlug });
  const tuple = agentAutomatorTuple(id, teamSlug);
  if (await hasTuple(tuple)) {
    const result = await writeOpenFgaTuples({ writes: [], deletes: [tuple] });
    if (!result.enabled) throw new ApiError('OpenFGA is not configured; cannot disable autonomous', 503);
  }
  return successResponse({ agent_id: id, team_slug: teamSlug, autonomous_enabled: false });
});
