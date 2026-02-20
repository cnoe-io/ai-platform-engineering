import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import type {
  AgentConfig,
  CreateAgentConfigInput,
  UpdateAgentConfigInput,
  SkillVisibility,
} from "@/types/agent-config";
import { BUILTIN_QUICK_START_TEMPLATES } from "@/types/agent-config";

/**
 * Agent Config API Routes
 *
 * Storage: MongoDB only (Agent Skills requires persistent storage)
 * 
 * Features:
 * - User ownership tracking (owner_id)
 * - System configs (is_system: true) are editable/deletable by admins only
 * - CRUD operations for user-created configs
 * - Falls back to built-in templates if MongoDB not configured
 */

// Storage configuration - MongoDB only for Agent Skills
const STORAGE_TYPE = isMongoDBConfigured ? "mongodb" : "none";

/**
 * Check if user is admin (from session role)
 */
function isUserAdmin(user: { email: string; role?: string }): boolean {
  return user.role === "admin";
}

const VALID_VISIBILITIES: SkillVisibility[] = ["private", "team", "global"];

/**
 * Resolve all team IDs that a user belongs to.
 */
async function getUserTeamIds(userEmail: string): Promise<string[]> {
  try {
    const teams = await getCollection("teams");
    const userTeams = await teams
      .find({ "members.user_id": userEmail })
      .project({ _id: 1 })
      .toArray();
    return userTeams.map((t) => t._id.toString());
  } catch {
    return [];
  }
}

/**
 * MongoDB storage functions
 */
async function saveAgentConfigToMongoDB(config: AgentConfig): Promise<void> {
  const collection = await getCollection<AgentConfig>("agent_configs");
  await collection.insertOne(config);
}

async function updateAgentConfigInMongoDB(
  id: string,
  updates: Partial<AgentConfig>,
  user: { email: string; role?: string }
): Promise<void> {
  console.log(`[MongoDB] ========== updateAgentConfigInMongoDB START ==========`);
  console.log(`[MongoDB] Config ID: ${id}`);
  console.log(`[MongoDB] User: ${user.email}, IsAdmin: ${isUserAdmin(user)}`);
  
  const collection = await getCollection<AgentConfig>("agent_configs");
  console.log(`[MongoDB] Got collection`);
  
  const existing = await collection.findOne({ id });
  console.log(`[MongoDB] Found existing config:`, {
    id: existing?.id,
    name: existing?.name,
    is_system: existing?.is_system,
    owner_id: existing?.owner_id,
    tasks_count: existing?.tasks?.length
  });
  
  if (!existing) {
    console.log(`[MongoDB] ERROR: Config not found`);
    throw new ApiError("Agent config not found", 404);
  }
  
  // System configs can only be modified by admins
  if (existing.is_system && !isUserAdmin(user)) {
    console.log(`[MongoDB] ERROR: Non-admin trying to modify system config`);
    throw new ApiError("Only admins can modify system configurations", 403);
  }
  
  // Non-system configs can only be modified by owner
  if (!existing.is_system && existing.owner_id !== user.email) {
    console.log(`[MongoDB] ERROR: User trying to modify another user's config`);
    throw new ApiError("You don't have permission to update this configuration", 403);
  }
  
  console.log(`[MongoDB] Permission checks passed`);
  
  const updatePayload = { ...updates, updated_at: new Date() };
  console.log(`[MongoDB] Update payload:`, JSON.stringify(updatePayload, null, 2));
  console.log(`[MongoDB] Update payload tasks count:`, updatePayload.tasks?.length);
  if (updatePayload.tasks && updatePayload.tasks.length > 0) {
    console.log(`[MongoDB] First task llm_prompt:`, updatePayload.tasks[0].llm_prompt);
  }
  
  console.log(`[MongoDB] Executing updateOne...`);
  const updateResult = await collection.updateOne(
    { id },
    { $set: updatePayload }
  );
  console.log(`[MongoDB] UpdateOne result:`, {
    matchedCount: updateResult.matchedCount,
    modifiedCount: updateResult.modifiedCount,
    acknowledged: updateResult.acknowledged
  });
  
  // Verify the update
  console.log(`[MongoDB] Fetching updated config for verification...`);
  const updated = await collection.findOne({ id });
  console.log(`[MongoDB] Verified updated config:`, {
    id: updated?.id,
    name: updated?.name,
    tasks_count: updated?.tasks?.length,
    updated_at: updated?.updated_at
  });
  if (updated?.tasks && updated.tasks.length > 0) {
    console.log(`[MongoDB] First task after update:`, {
      display_text: updated.tasks[0].display_text,
      llm_prompt: updated.tasks[0].llm_prompt,
      subagent: updated.tasks[0].subagent
    });
  }
  console.log(`[MongoDB] ========== updateAgentConfigInMongoDB END ==========`);
}

async function deleteAgentConfigFromMongoDB(
  id: string,
  user: { email: string; role?: string }
): Promise<void> {
  const collection = await getCollection<AgentConfig>("agent_configs");
  
  const existing = await collection.findOne({ id });
  if (!existing) {
    throw new ApiError("Agent config not found", 404);
  }
  
  // System configs can only be deleted by admins
  if (existing.is_system && !isUserAdmin(user)) {
    throw new ApiError("Only admins can delete system configurations", 403);
  }
  
  // Non-system configs can only be deleted by owner
  if (!existing.is_system && existing.owner_id !== user.email) {
    throw new ApiError("You don't have permission to delete this configuration", 403);
  }
  
  await collection.deleteOne({ id });
}

async function getAgentConfigsFromMongoDB(ownerEmail: string): Promise<AgentConfig[]> {
  const collection = await getCollection<AgentConfig>("agent_configs");
  const userTeamIds = await getUserTeamIds(ownerEmail);

  const configs = await collection
    .find({
      $or: [
        { is_system: true },
        { owner_id: ownerEmail },
        { visibility: "global" },
        ...(userTeamIds.length > 0
          ? [{ visibility: "team" as const, shared_with_teams: { $in: userTeamIds } }]
          : []),
      ],
    })
    .sort({ is_system: -1, created_at: -1 })
    .toArray();

  return configs;
}

async function getAgentConfigByIdFromMongoDB(
  id: string,
  ownerEmail: string
): Promise<AgentConfig | null> {
  const collection = await getCollection<AgentConfig>("agent_configs");
  const userTeamIds = await getUserTeamIds(ownerEmail);

  const config = await collection.findOne({
    id,
    $or: [
      { is_system: true },
      { owner_id: ownerEmail },
      { visibility: "global" },
      ...(userTeamIds.length > 0
        ? [{ visibility: "team" as const, shared_with_teams: { $in: userTeamIds } }]
        : []),
    ],
  });

  return config;
}

// POST /api/agent-configs - Create a new agent config
export const POST = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Skills requires MongoDB to be configured", 503);
  }

  return await withAuth(request, async (req, user) => {
    const body: CreateAgentConfigInput = await request.json();

    // Validate required fields
    if (!body.name || !body.category || !body.tasks || body.tasks.length === 0) {
      throw new ApiError("Missing required fields: name, category, and at least one task are required", 400);
    }

    // Validate tasks
    for (const task of body.tasks) {
      if (!task.display_text || !task.llm_prompt || !task.subagent) {
        throw new ApiError("Each task must have display_text, llm_prompt, and subagent", 400);
      }
    }

    // Validate visibility
    const visibility: SkillVisibility = body.visibility || "private";
    if (!VALID_VISIBILITIES.includes(visibility)) {
      throw new ApiError(`Invalid visibility: ${visibility}. Must be one of: ${VALID_VISIBILITIES.join(", ")}`, 400);
    }
    if (visibility === "team" && (!body.shared_with_teams || body.shared_with_teams.length === 0)) {
      throw new ApiError("At least one team must be selected when visibility is 'team'", 400);
    }

    // Generate ID
    const id = `agent-config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();

    const config: AgentConfig = {
      id,
      name: body.name,
      description: body.description,
      category: body.category,
      tasks: body.tasks,
      owner_id: user.email,
      is_system: false,
      created_at: now,
      updated_at: now,
      metadata: body.metadata,
      visibility,
      shared_with_teams: visibility === "team" ? body.shared_with_teams : undefined,
    };

    await saveAgentConfigToMongoDB(config);
    console.log(`[AgentConfig] Created agent config "${body.name}" by ${user.email} (visibility: ${visibility})`);

    return successResponse({
      id,
      message: "Agent config created successfully",
    }, 201);
  });
});

// GET /api/agent-configs - Retrieve all agent configs (system + user's own)
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Skills requires MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  return await withAuth(request, async (req, user) => {
    if (id) {
      // Get single config by ID
      console.log(`[API GET] Fetching single config: ${id} for user: ${user.email}`);
      const config = await getAgentConfigByIdFromMongoDB(id, user.email);
      if (!config) {
        console.log(`[API GET] Config not found: ${id}`);
        throw new ApiError("Agent config not found", 404);
      }
      console.log(`[API GET] Returning config:`, {
        id: config.id,
        name: config.name,
        tasks_count: config.tasks?.length,
        updated_at: config.updated_at
      });
      if (config.tasks && config.tasks.length > 0) {
        console.log(`[API GET] First task llm_prompt:`, config.tasks[0].llm_prompt);
      }
      return NextResponse.json(config) as NextResponse;
    } else {
      // Get all configs
      console.log(`[API GET] Fetching all configs for user: ${user.email}`);
      const configs = await getAgentConfigsFromMongoDB(user.email);
      console.log(`[API GET] Returning ${configs.length} configs`);
      return NextResponse.json(configs) as NextResponse;
    }
  });
});

// PUT /api/agent-configs?id=<configId> - Update an existing agent config
export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Skills requires MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  console.log(`[API PUT] ============ UPDATE REQUEST START ============`);
  console.log(`[API PUT] Config ID: ${id}`);

  if (!id) {
    throw new ApiError("Agent config ID is required", 400);
  }

  return await withAuth(request, async (req, user) => {
    console.log(`[API PUT] User: ${user.email}, Role: ${user.role}, IsAdmin: ${isUserAdmin(user)}`);
    
    const body: UpdateAgentConfigInput = await request.json();
    console.log(`[API PUT] Request body:`, JSON.stringify(body, null, 2));

    // Validate that at least one field is provided
    if (Object.keys(body).length === 0) {
      throw new ApiError("At least one field must be provided for update", 400);
    }

    // Validate visibility if provided
    if (body.visibility !== undefined) {
      if (!VALID_VISIBILITIES.includes(body.visibility)) {
        throw new ApiError(`Invalid visibility: ${body.visibility}. Must be one of: ${VALID_VISIBILITIES.join(", ")}`, 400);
      }
      if (body.visibility === "team" && (!body.shared_with_teams || body.shared_with_teams.length === 0)) {
        throw new ApiError("At least one team must be selected when visibility is 'team'", 400);
      }
      if (body.visibility !== "team") {
        body.shared_with_teams = undefined;
      }
    }

    // Validate tasks if provided
    if (body.tasks) {
      console.log(`[API PUT] Validating ${body.tasks.length} tasks...`);
      if (body.tasks.length === 0) {
        throw new ApiError("At least one task is required", 400);
      }
      for (const task of body.tasks) {
        if (!task.display_text || !task.llm_prompt || !task.subagent) {
          throw new ApiError("Each task must have display_text, llm_prompt, and subagent", 400);
        }
      }
      console.log(`[API PUT] Tasks validation passed`);
      // Log first task's llm_prompt for debugging
      console.log(`[API PUT] First task llm_prompt:`, body.tasks[0].llm_prompt);
    }

    // Pass full user object for admin check
    console.log(`[API PUT] Calling updateAgentConfigInMongoDB...`);
    await updateAgentConfigInMongoDB(id, body, user);
    console.log(`[AgentConfig] Updated agent config "${id}" by ${user.email}`);
    console.log(`[API PUT] ============ UPDATE REQUEST END ============`);

    return successResponse({
      id,
      message: "Agent config updated successfully",
    });
  });
});

// DELETE /api/agent-configs?id=<configId> - Delete an agent config
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Skills requires MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Agent config ID is required", 400);
  }

  return await withAuth(request, async (req, user) => {
    // Pass full user object for admin check
    await deleteAgentConfigFromMongoDB(id, user);
    console.log(`[AgentConfig] Deleted agent config "${id}" by ${user.email}`);

    return successResponse({
      id,
      message: "Agent config deleted successfully",
    });
  });
});
