/**
 * API routes for Dynamic Agents management.
 * 
 * These routes proxy to the dynamic-agents backend service.
 * For MVP, they directly access MongoDB (same pattern as other admin routes).
 */

import { NextRequest, NextResponse } from "next/server";
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
  DynamicAgentConfigCreate,
  DynamicAgentConfigUpdate,
  SubAgentRef,
  VisibilityType,
} from "@/types/dynamic-agent";
import type { Collection } from "mongodb";

const COLLECTION_NAME = "dynamic_agents";

/**
 * Validate that subagents have compatible visibility with the parent agent.
 * 
 * Rules:
 * - Private agent → can use private, team, or global subagents
 * - Team agent → can use team or global subagents  
 * - Global agent → can only use global subagents
 */
async function validateSubagentVisibility(
  parentVisibility: VisibilityType,
  subagents: SubAgentRef[],
  collection: Collection<DynamicAgentConfig>
): Promise<{ valid: boolean; error?: string }> {
  if (!subagents || subagents.length === 0) {
    return { valid: true };
  }

  for (const subagent of subagents) {
    const subagentConfig = await collection.findOne({ _id: subagent.agent_id });
    if (!subagentConfig) {
      return { valid: false, error: `Subagent "${subagent.agent_id}" not found` };
    }

    const subVis = subagentConfig.visibility;

    // Global parent can only use global subagents
    if (parentVisibility === "global" && subVis !== "global") {
      return {
        valid: false,
        error: `Global agents can only use global subagents. "${subagentConfig.name}" is ${subVis}.`,
      };
    }

    // Team parent can use team or global subagents
    if (parentVisibility === "team" && subVis === "private") {
      return {
        valid: false,
        error: `Team agents can only use team or global subagents. "${subagentConfig.name}" is private.`,
      };
    }

    // Private parent can use any visibility (private, team, or global)
    // No restrictions needed
  }

  return { valid: true };
}

/**
 * GET /api/dynamic-agents
 * List dynamic agents visible to the current user.
 * 
 * Query params:
 * - enabled_only=true: Only return enabled agents (useful for subagent selection)
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);
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
                ? [{ visibility: "team", shared_with_teams: { $in: userTeams } }]
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
      collection.find(query).sort({ created_at: -1 }).skip(skip).limit(pageSize).toArray(),
      collection.countDocuments(query),
    ]);

    return paginatedResponse(items, total, page, pageSize);
  });
});

/**
 * POST /api/dynamic-agents
 * Create a new dynamic agent configuration.
 * Requires admin role.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const body: DynamicAgentConfigCreate = await request.json();

    // Validate required fields
    if (!body.id) {
      throw new ApiError("Missing required field: id", 400);
    }

    if (!body.name || !body.system_prompt) {
      throw new ApiError("Missing required fields: name, system_prompt", 400);
    }

    if (!body.model_id || !body.model_provider) {
      throw new ApiError("Missing required fields: model_id, model_provider", 400);
    }

    // Validate ID format (alphanumeric and underscores only)
    if (!/^[a-z0-9_]+$/.test(body.id)) {
      throw new ApiError("Invalid ID format: must be lowercase alphanumeric with underscores", 400);
    }

    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

    // Check for ID clash
    const existing = await collection.findOne({ _id: body.id });
    if (existing) {
      throw new ApiError(`Agent with ID "${body.id}" already exists`, 409);
    }

    // Validate subagent visibility compatibility
    if (body.subagents && body.subagents.length > 0) {
      const parentVisibility = body.visibility || "private";
      const validationResult = await validateSubagentVisibility(
        parentVisibility,
        body.subagents,
        collection
      );
      if (!validationResult.valid) {
        throw new ApiError(validationResult.error!, 400);
      }
    }

    const now = new Date();

    const newAgent: DynamicAgentConfig = {
      _id: body.id,
      name: body.name,
      description: body.description,
      system_prompt: body.system_prompt,
      allowed_tools: body.allowed_tools || {},
      builtin_tools: body.builtin_tools,
      model_id: body.model_id,
      model_provider: body.model_provider,
      visibility: body.visibility || "private",
      shared_with_teams: body.shared_with_teams,
      subagents: body.subagents || [],
      enabled: body.enabled ?? true,
      owner_id: user.email,
      is_system: false,
      created_at: now,
      updated_at: now,
    };

    await collection.insertOne(newAgent as any);

    return successResponse(newAgent, 201);
  });
});

/**
 * PUT /api/dynamic-agents?id=<agent_id>
 * Update a dynamic agent configuration.
 * Requires admin role.
 */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Agent ID is required", 400);
  }

  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const body: DynamicAgentConfigUpdate = await request.json();
    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

    // Check if agent exists
    const existing = await collection.findOne({ _id: id });
    if (!existing) {
      throw new ApiError("Agent not found", 404);
    }

    // Determine final values for visibility validation
    const finalVisibility = body.visibility ?? existing.visibility;
    const finalSubagents = body.subagents ?? existing.subagents;

    // Validate subagent visibility compatibility
    if (finalSubagents && finalSubagents.length > 0) {
      const validationResult = await validateSubagentVisibility(
        finalVisibility,
        finalSubagents,
        collection
      );
      if (!validationResult.valid) {
        throw new ApiError(validationResult.error!, 400);
      }
    }

    // Build update
    const updateFields: any = {
      updated_at: new Date(),
    };

    // Only include fields that were provided
    if (body.name !== undefined) updateFields.name = body.name;
    if (body.description !== undefined) updateFields.description = body.description;
    if (body.system_prompt !== undefined) updateFields.system_prompt = body.system_prompt;
    if (body.allowed_tools !== undefined) updateFields.allowed_tools = body.allowed_tools;
    if (body.builtin_tools !== undefined) updateFields.builtin_tools = body.builtin_tools;
    if (body.model_id !== undefined) updateFields.model_id = body.model_id;
    if (body.model_provider !== undefined) updateFields.model_provider = body.model_provider;
    if (body.visibility !== undefined) updateFields.visibility = body.visibility;
    if (body.shared_with_teams !== undefined) updateFields.shared_with_teams = body.shared_with_teams;
    if (body.subagents !== undefined) updateFields.subagents = body.subagents;
    if (body.enabled !== undefined) updateFields.enabled = body.enabled;

    await collection.updateOne({ _id: id }, { $set: updateFields });

    const updated = await collection.findOne({ _id: id });
    return successResponse(updated);
  });
});

/**
 * DELETE /api/dynamic-agents?id=<agent_id>
 * Delete a dynamic agent configuration.
 * Requires admin role. System agents cannot be deleted.
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

    // Check if agent exists
    const existing = await collection.findOne({ _id: id });
    if (!existing) {
      throw new ApiError("Agent not found", 404);
    }

    // System agents cannot be deleted
    if (existing.is_system) {
      throw new ApiError("System agents cannot be deleted", 400);
    }

    await collection.deleteOne({ _id: id });

    return successResponse({ deleted: id });
  });
});
