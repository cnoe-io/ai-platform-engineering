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
} from "@/types/dynamic-agent";

const COLLECTION_NAME = "dynamic_agents";

/**
 * GET /api/dynamic-agents
 * List dynamic agents visible to the current user.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);
    const { page, pageSize, skip } = getPaginationParams(request);

    // Build visibility filter
    let query: any = {};
    
    if (session.role !== "admin") {
      // Non-admins see: their own, global, or team-shared agents
      const userTeams = await getUserTeamIds(user.email);
      
      query = {
        $and: [
          { enabled: true },
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
    if (!body.name || !body.system_prompt) {
      throw new ApiError("Missing required fields: name, system_prompt", 400);
    }

    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

    const now = new Date().toISOString();
    const agentId = `agent-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const newAgent: DynamicAgentConfig = {
      _id: agentId,
      name: body.name,
      description: body.description,
      system_prompt: body.system_prompt,
      agents_md: body.agents_md,
      extension_prompt: body.extension_prompt,
      allowed_tools: body.allowed_tools || {},
      model_id: body.model_id,
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

    // Build update
    const updateFields: any = {
      updated_at: new Date().toISOString(),
    };

    // Only include fields that were provided
    if (body.name !== undefined) updateFields.name = body.name;
    if (body.description !== undefined) updateFields.description = body.description;
    if (body.system_prompt !== undefined) updateFields.system_prompt = body.system_prompt;
    if (body.agents_md !== undefined) updateFields.agents_md = body.agents_md;
    if (body.extension_prompt !== undefined) updateFields.extension_prompt = body.extension_prompt;
    if (body.allowed_tools !== undefined) updateFields.allowed_tools = body.allowed_tools;
    if (body.model_id !== undefined) updateFields.model_id = body.model_id;
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
