/**
 * API route for listing available dynamic agents for the current user.
 * 
 * This returns agents that the user can chat with:
 * - Global agents (visibility: 'global')
 * - Team agents (visibility: 'team') for teams the user belongs to
 * - Private agents (visibility: 'private') owned by the user
 * 
 * Only returns enabled agents.
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withErrorHandler,
  successResponse,
  getAuthFromBearerOrSession,
  requireRbacPermission,
} from "@/lib/api-middleware";
import { filterResourcesByPermission } from "@/lib/rbac/resource-authz";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

const COLLECTION_NAME = "dynamic_agents";

/**
 * GET /api/dynamic-agents/available
 * List dynamic agents available for the current user to chat with.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "dynamic_agent", "view");

  const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

  const agents = await collection
    .find({ enabled: true })
    .sort({ name: 1 })
    .toArray();

  const visibleAgents = await filterResourcesByPermission(session, agents, {
    type: "agent",
    action: "use",
    id: (agent) => String(agent._id),
  });

  // Normalize legacy model_id/model_provider → model
  const normalizedAgents = visibleAgents.map((agent) => {
    const doc = agent as unknown as Record<string, unknown>;
    if (doc.model_id && !doc.model) {
      doc.model = { id: doc.model_id, provider: doc.model_provider || "unknown" };
      delete doc.model_id;
      delete doc.model_provider;
    }
    return doc;
  });

  return successResponse(normalizedAgents);
});
