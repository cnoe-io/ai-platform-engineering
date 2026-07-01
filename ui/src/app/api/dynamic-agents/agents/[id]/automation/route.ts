import {
  ApiError, getAuthFromBearerOrSession, successResponse, withErrorHandler,
} from '@/lib/api-middleware';
import { requireAgentPermission } from '@/lib/rbac/resource-authz';
import { readOpenFgaTuples, writeOpenFgaTuples, type OpenFgaTupleKey } from '@/lib/rbac/openfga';
import { organizationObjectId } from '@/lib/rbac/organization';
import { NextRequest } from 'next/server';

/**
 * Per-agent autonomous enablement for a team.
 * Writes/deletes  team:<slug>#member -> automator -> agent:<id>.
 * PUT/DELETE require can_manage on the agent AND (PUT) the team to hold Layer 1
 * eligibility (automation_eligible on the org). can_schedule = automator and can_use.
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

export const PUT = withErrorHandler(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const { id } = await context.params;
  const teamSlug = await readTeamSlug(request);
  await requireAgentPermission(session, id, 'manage');
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
  const { session } = await getAuthFromBearerOrSession(request);
  const { id } = await context.params;
  const teamSlug = await readTeamSlug(request);
  await requireAgentPermission(session, id, 'manage');
  const tuple = agentAutomatorTuple(id, teamSlug);
  if (await hasTuple(tuple)) {
    const result = await writeOpenFgaTuples({ writes: [], deletes: [tuple] });
    if (!result.enabled) throw new ApiError('OpenFGA is not configured; cannot disable autonomous', 503);
  }
  return successResponse({ agent_id: id, team_slug: teamSlug, autonomous_enabled: false });
});
