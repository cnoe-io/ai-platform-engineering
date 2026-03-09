/**
 * API route for listing available subagents for a dynamic agent.
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  requireAdmin,
} from "@/lib/api-middleware";
import type { DynamicAgentConfig, SubAgentRef } from "@/types/dynamic-agent";

const COLLECTION_NAME = "dynamic_agents";

/**
 * GET /api/dynamic-agents/available-subagents?id=<agent_id>
 * List agents that can be configured as subagents for the given agent.
 * 
 * Returns all enabled agents except:
 * - The agent itself (can't delegate to itself)
 * - Agents that would create a circular reference
 * 
 * Requires admin role.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("id");

  if (!agentId) {
    throw new ApiError("Agent ID is required", 400);
  }

  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

    // Get the parent agent
    const parentAgent = await collection.findOne({ _id: agentId });
    if (!parentAgent) {
      throw new ApiError("Agent not found", 404);
    }

    // Get all enabled agents (enabled: true OR enabled field doesn't exist, which defaults to true)
    const allAgents = await collection.find({ 
      $or: [{ enabled: true }, { enabled: { $exists: false } }] 
    }).toArray();

    // Find agents that would create a cycle
    const ancestors = getAncestorAgentIds(agentId, allAgents);

    // Filter out self and ancestors
    const available = allAgents
      .filter((agent) => {
        if (agent._id === agentId) return false; // Can't delegate to self
        if (ancestors.has(agent._id)) return false; // Would create a cycle
        return true;
      })
      .map((agent) => ({
        id: agent._id,
        name: agent.name,
        description: agent.description,
        visibility: agent.visibility,
      }));

    return successResponse({ agents: available });
  });
});

/**
 * Get all agent IDs that have this agent as a subagent (directly or indirectly).
 * Used for cycle detection.
 */
function getAncestorAgentIds(
  agentId: string,
  allAgents: DynamicAgentConfig[]
): Set<string> {
  const ancestors = new Set<string>();

  // Build a map: child_id -> set of parent_ids
  const childToParents = new Map<string, Set<string>>();

  for (const agent of allAgents) {
    const subagents = agent.subagents || [];
    for (const subagentRef of subagents) {
      if (!childToParents.has(subagentRef.agent_id)) {
        childToParents.set(subagentRef.agent_id, new Set());
      }
      childToParents.get(subagentRef.agent_id)!.add(agent._id);
    }
  }

  // BFS to find all ancestors
  const queue = [agentId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const parents = childToParents.get(current);
    if (parents) {
      for (const parentId of parents) {
        ancestors.add(parentId);
        queue.push(parentId);
      }
    }
  }

  return ancestors;
}
