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
} from "@/lib/api-middleware";
import { baselineBootstrapTuples } from "@/lib/rbac/baseline-access";
import { filterResourcesByPermission } from "@/lib/rbac/resource-authz";
import { writeOpenFgaTuples } from "@/lib/rbac/openfga";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

const COLLECTION_NAME = "dynamic_agents";
const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

function normalizeDefaultAgentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && OPENFGA_ID_PATTERN.test(trimmed) ? trimmed : null;
}

async function ensureBaselineAccess(session: { sub?: unknown; role?: string }): Promise<void> {
  if (typeof session.sub !== "string" || !session.sub.trim()) return;
  try {
    await writeOpenFgaTuples({
      writes: baselineBootstrapTuples(session.sub.trim(), session.role === "admin"),
      deletes: [],
    });
  } catch (error) {
    console.warn(
      "[DynamicAgentsAvailable] Failed to reconcile baseline OpenFGA grants:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function ensureConfiguredDefaultAgentGrant(): Promise<void> {
  try {
    const config = await getCollection<{ default_agent_id?: unknown }>("platform_config");
    const doc = await config.findOne({ _id: "platform_settings" } as never);
    const defaultAgentId =
      normalizeDefaultAgentId(doc?.default_agent_id) ?? normalizeDefaultAgentId(process.env.DEFAULT_AGENT_ID);
    if (!defaultAgentId) return;
    await writeOpenFgaTuples({
      writes: [{ user: "user:*", relation: "user", object: `agent:${defaultAgentId}` }],
      deletes: [],
    });
  } catch (error) {
    console.warn(
      "[DynamicAgentsAvailable] Failed to reconcile default-agent OpenFGA grant:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function ensureAllUsersAgentGrants(agents: DynamicAgentConfig[]): Promise<void> {
  const writes = new Map<string, { user: string; relation: "user"; object: string }>();

  for (const agent of agents) {
    const agentId = normalizeDefaultAgentId(String(agent._id));
    if (!agentId || agent.visibility !== "global") continue;
    writes.set(agentId, { user: "user:*", relation: "user", object: `agent:${agentId}` });
  }

  if (writes.size === 0) return;

  try {
    await writeOpenFgaTuples({
      writes: Array.from(writes.values()),
      deletes: [],
    });
  } catch (error) {
    console.warn(
      "[DynamicAgentsAvailable] Failed to reconcile global-agent OpenFGA grants:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * GET /api/dynamic-agents/available
 * List dynamic agents available for the current user to chat with.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await ensureBaselineAccess(session);

  const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);
  await ensureConfiguredDefaultAgentGrant();

  const agents = await collection
    .find({ enabled: true })
    .sort({ name: 1 })
    .toArray();
  await ensureAllUsersAgentGrants(agents);

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
