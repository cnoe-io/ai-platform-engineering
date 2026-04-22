/**
 * API routes for Dynamic Agents management.
 *
 * All operations use local MongoDB directly.
 * The gateway owns all config writes — DA is a pure runtime reader.
 */

import { NextRequest } from "next/server";
import { Collection } from "mongodb";
import { getCollection } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  requireAdmin,
  getPaginationParams,
  paginatedResponse,
  getUserTeamIds,
} from "@/lib/api-middleware";
import type {
  DynamicAgentConfig,
  VisibilityType,
  SubAgentRef,
} from "@/types/dynamic-agent";

const COLLECTION_NAME = "dynamic_agents";

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Reserved agent slugs that cannot be used as agent IDs.
 * These are LangGraph/deepagents internal names that would
 * conflict with namespace routing.
 *
 * Ported from DA mongo.py — DA no longer does slug checks
 * after CRUD migration.
 */
const RESERVED_AGENT_SLUGS = new Set([
  // LangGraph internal node names
  "__start__",
  "__end__",
  "__interrupt__",
  "__checkpoint__",
  "__error__",
  "start",
  "end",
  // LangGraph react agent node names
  "agent",
  "tools",
  "call-model",
  // DeepAgents built-in
  "general-purpose",
  "task",
]);

/**
 * Convert agent name to URL-safe slug.
 *
 * Examples:
 *   'My Test Agent' → 'my-test-agent'
 *   'RAG Helper!!!' → 'rag-helper'
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Mutable fields allowed in agent create/update requests. */
const AGENT_MUTABLE_FIELDS = [
  "name",
  "description",
  "system_prompt",
  "allowed_tools",
  "builtin_tools",
  "model_id",
  "model_provider",
  "visibility",
  "shared_with_teams",
  "subagents",
  "ui",
  "enabled",
] as const;

/**
 * Pick only allowed mutable fields from body, filtering out
 * undefined values. Prevents injection of server-controlled
 * fields like is_system, config_driven, owner_id.
 */
function pickMutableFields(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of AGENT_MUTABLE_FIELDS) {
    if (body[field] !== undefined) {
      result[field] = body[field];
    }
  }
  return result;
}

/**
 * Validate that subagents have compatible visibility with parent.
 *
 * Rules:
 * - Private agent → can use private, team, or global subagents
 * - Team agent → can use team or global subagents
 * - Global agent → can only use global subagents
 */
async function validateSubagentVisibility(
  parentVisibility: VisibilityType,
  subagents: SubAgentRef[],
  collection: Collection<DynamicAgentConfig>,
): Promise<{ valid: boolean; error?: string }> {
  if (!subagents || subagents.length === 0) return { valid: true };

  for (const ref of subagents) {
    const sub = await collection.findOne({ _id: ref.agent_id });
    if (!sub) {
      return {
        valid: false,
        error: `Subagent "${ref.agent_id}" not found`,
      };
    }

    const subVis = sub.visibility as VisibilityType;

    // Global parent → only global subagents
    if (parentVisibility === "global" && subVis !== "global") {
      return {
        valid: false,
        error: `Global agents can only use global subagents. "${sub.name}" is ${subVis}.`,
      };
    }
    // Team parent → team or global subagents only
    if (parentVisibility === "team" && subVis === "private") {
      return {
        valid: false,
        error: `Team agents can only use team or global subagents. "${sub.name}" is private.`,
      };
    }
    // Private parent → any visibility (no restriction)
  }

  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════
// GET — list agents
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/dynamic-agents
 * List dynamic agents visible to the current user.
 *
 * Query params:
 * - enabled_only=true: Only return enabled agents (useful for subagent selection)
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    const collection =
      await getCollection<DynamicAgentConfig>(COLLECTION_NAME);
    const { page, pageSize, skip } = getPaginationParams(request);
    const { searchParams } = new URL(request.url);
    const enabledOnly = searchParams.get("enabled_only") === "true";

    // Build visibility filter
    let query: any = {};

    if (session.role !== "admin") {
      // Non-admins see: their own, global, or team-shared agents
      const userTeams = await getUserTeamIds(user.email);

      query = {
        $and: [
          // enabled: true OR enabled field doesn't exist (defaults to true)
          { $or: [{ enabled: true }, { enabled: { $exists: false } }] },
          {
            $or: [
              { owner_id: user.email },
              { visibility: "global" },
              ...(userTeams.length > 0
                ? [
                    {
                      visibility: "team",
                      shared_with_teams: { $in: userTeams },
                    },
                  ]
                : []),
            ],
          },
        ],
      };
    } else if (enabledOnly) {
      // Admin with enabled_only flag (e.g., for subagent selection)
      // enabled: true OR enabled field doesn't exist (defaults to true)
      query = { $or: [{ enabled: true }, { enabled: { $exists: false } }] };
    }

    const [items, total] = await Promise.all([
      collection
        .find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(pageSize)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return paginatedResponse(items, total, page, pageSize);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST — create agent
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/dynamic-agents
 * Create a new dynamic agent configuration.
 * Requires admin role.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const body = await request.json();

    if (!body.name || typeof body.name !== "string") {
      throw new ApiError("Agent name is required", 400);
    }
    if (!body.system_prompt || typeof body.system_prompt !== "string") {
      throw new ApiError("System prompt is required", 400);
    }
    if (!body.model_id || typeof body.model_id !== "string") {
      throw new ApiError("Model ID is required", 400);
    }
    if (!body.model_provider || typeof body.model_provider !== "string") {
      throw new ApiError("Model provider is required", 400);
    }

    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

    // Generate slug from name
    const agentId = slugify(body.name);
    if (!agentId) {
      throw new ApiError("Agent name must contain at least one alphanumeric character", 400);
    }

    // Reserved slug check
    if (RESERVED_AGENT_SLUGS.has(agentId) || agentId.startsWith("__")) {
      throw new ApiError(`Agent name "${body.name}" is reserved`, 409);
    }

    // Uniqueness check
    const existing = await collection.findOne({ _id: agentId });
    if (existing) {
      throw new ApiError(
        `Agent with ID "${agentId}" already exists`,
        409,
      );
    }

    // Subagent visibility validation
    const visibility: VisibilityType = body.visibility ?? "private";
    const subagents: SubAgentRef[] = body.subagents ?? [];
    if (subagents.length > 0) {
      const result = await validateSubagentVisibility(
        visibility,
        subagents,
        collection,
      );
      if (!result.valid) {
        throw new ApiError(result.error!, 400);
      }
    }

    // Build document with explicit field allowlist (Security VII)
    const now = new Date();
    const doc = {
      _id: agentId,
      name: body.name as string,
      description: (body.description as string) ?? "",
      system_prompt: body.system_prompt as string,
      allowed_tools: (body.allowed_tools as Record<string, string[]>) ?? {},
      builtin_tools: body.builtin_tools ?? undefined,
      model_id: body.model_id as string,
      model_provider: body.model_provider as string,
      visibility,
      shared_with_teams: (body.shared_with_teams as string[]) ?? [],
      subagents,
      ui: body.ui ?? undefined,
      enabled: (body.enabled as boolean) ?? true,
      // Server-controlled fields — never from request body
      owner_id: user.email,
      is_system: false,
      config_driven: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    await collection.insertOne(doc as any);

    return successResponse(doc, 201);
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT — update agent
// ═══════════════════════════════════════════════════════════════

/**
 * PUT /api/dynamic-agents?id=<agent_id>
 * Update a dynamic agent configuration.
 * Requires admin role. Config-driven agents cannot be modified.
 */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Agent ID is required", 400);
  }

  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const body = await request.json();
    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

    // Verify agent exists
    const agent = await collection.findOne({ _id: id });
    if (!agent) {
      throw new ApiError("Agent not found", 404);
    }

    // Config-driven guard
    if (agent.config_driven) {
      throw new ApiError(
        "Config-driven agents cannot be modified. Update config.yaml instead.",
        403,
      );
    }

    // Build update with explicit field allowlist
    const updateData = pickMutableFields(body);
    if (Object.keys(updateData).length === 0) {
      // No fields to update — return current state
      return successResponse(agent);
    }

    // Subagent visibility validation (using merged final values)
    const finalVisibility = (updateData.visibility ??
      agent.visibility) as VisibilityType;
    const finalSubagents = (updateData.subagents ??
      agent.subagents ??
      []) as SubAgentRef[];

    if (finalSubagents.length > 0) {
      const result = await validateSubagentVisibility(
        finalVisibility,
        finalSubagents,
        collection,
      );
      if (!result.valid) {
        throw new ApiError(result.error!, 400);
      }
    }

    updateData.updated_at = new Date().toISOString();

    const updated = await collection.findOneAndUpdate(
      { _id: id },
      { $set: updateData },
      { returnDocument: "after" },
    );

    if (!updated) {
      throw new ApiError("Failed to update agent", 500);
    }

    return successResponse(updated);
  });
});

// ═══════════════════════════════════════════════════════════════
// DELETE — delete agent
// ═══════════════════════════════════════════════════════════════

/**
 * DELETE /api/dynamic-agents?id=<agent_id>
 * Delete a dynamic agent configuration.
 * Requires admin role. System and config-driven agents cannot be deleted.
 */
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Agent ID is required", 400);
  }

  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

    // Verify agent exists
    const agent = await collection.findOne({ _id: id });
    if (!agent) {
      throw new ApiError("Agent not found", 404);
    }

    // System agent guard
    if (agent.is_system) {
      throw new ApiError("System agents cannot be deleted", 400);
    }

    // Config-driven guard
    if (agent.config_driven) {
      throw new ApiError(
        "Config-driven agents cannot be deleted. Remove from config.yaml instead.",
        403,
      );
    }

    await collection.deleteOne({ _id: id });

    return successResponse({ deleted: id });
  });
});
