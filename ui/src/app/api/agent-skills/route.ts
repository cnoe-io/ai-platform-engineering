import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  getUserTeamIds,
} from "@/lib/api-middleware";
import type {
  AgentSkill,
  CreateAgentSkillInput,
  UpdateAgentSkillInput,
  SkillVisibility,
  ScanStatus,
} from "@/types/agent-skill";
import { BUILTIN_QUICK_START_TEMPLATES } from "@/types/agent-skill";
import { syncSkillResource } from "@/lib/rbac/keycloak-resource-sync";
import {
  extractRealmRolesFromSession,
  extractSkillAccessFromJwtRoles,
} from "@/lib/rbac/task-skill-realm-access";

/**
 * Agent Config API Routes
 *
 * Storage: MongoDB only (agent config skills require persistent storage)
 * 
 * Features:
 * - User ownership tracking (owner_id)
 * - System configs (is_system: true) are editable/deletable by admins only
 * - CRUD operations for user-created configs
 * - Falls back to built-in templates if MongoDB not configured
 */

// Storage configuration - MongoDB only for agent config skills
const STORAGE_TYPE = isMongoDBConfigured ? "mongodb" : "none";
const BACKEND_SKILLS_URL = process.env.BACKEND_SKILLS_URL || "";

async function scanSkillContent(
  name: string,
  content: string,
  configId?: string,
): Promise<{ scan_status: ScanStatus; scan_summary?: string }> {
  if (!BACKEND_SKILLS_URL || !content?.trim()) {
    return { scan_status: "unscanned" };
  }
  try {
    const resp = await fetch(`${BACKEND_SKILLS_URL}/skills/scan-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content, config_id: configId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      console.warn(`[ScanSkill] Backend returned ${resp.status}`);
      return { scan_status: "unscanned" };
    }
    const data = await resp.json();
    return {
      scan_status: (data.scan_status as ScanStatus) || "unscanned",
      scan_summary: data.summary,
    };
  } catch (err) {
    console.warn("[ScanSkill] Scanner unavailable:", err);
    return { scan_status: "unscanned" };
  }
}

const ANCILLARY_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB soft limit (FR-028)

/**
 * Fire-and-forget supervisor skills refresh so the MAS picks up
 * newly saved/updated agent configs without a manual admin refresh.
 * Uses `include_hubs=false` query hint (custom extension) so the
 * backend only re-merges cheap sources (filesystem + MongoDB) and
 * keeps the expensive hub cache intact.
 */
function triggerSupervisorRefresh(): void {
  if (!BACKEND_SKILLS_URL) return;
  const url = `${BACKEND_SKILLS_URL}/skills/refresh?include_hubs=false`;
  fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    console.warn("[AgentSkill] Background supervisor refresh failed:", err);
  });
}

function validateAncillaryFiles(
  files: Record<string, string> | undefined,
): { valid: boolean; totalBytes: number; warning?: string } {
  if (!files || Object.keys(files).length === 0) {
    return { valid: true, totalBytes: 0 };
  }
  const totalBytes = Object.values(files).reduce((sum, v) => sum + new Blob([v]).size, 0);
  if (totalBytes > ANCILLARY_SIZE_LIMIT) {
    return {
      valid: true,
      totalBytes,
      warning: `Ancillary files total ${(totalBytes / 1024 / 1024).toFixed(1)} MB, exceeding the recommended 5 MB limit. Consider using a skill hub for larger skills.`,
    };
  }
  return { valid: true, totalBytes };
}

/**
 * Check if user is admin (from session role)
 */
function isUserAdmin(user: { email: string; role?: string }): boolean {
  return user.role === "admin";
}

const VALID_VISIBILITIES: SkillVisibility[] = ["private", "team", "global"];

/**
 * MongoDB storage functions
 */
async function saveAgentSkillToMongoDB(config: AgentSkill): Promise<void> {
  const collection = await getCollection<AgentSkill>("agent_skills");
  await collection.insertOne(config);
}

async function updateAgentSkillInMongoDB(
  id: string,
  updates: Partial<AgentSkill>,
  user: { email: string; role?: string }
): Promise<void> {
  console.log(`[MongoDB] ========== updateAgentSkillInMongoDB START ==========`);
  console.log(`[MongoDB] Config ID: ${id}`);
  console.log(`[MongoDB] User: ${user.email}, IsAdmin: ${isUserAdmin(user)}`);
  
  const collection = await getCollection<AgentSkill>("agent_skills");
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
  console.log(`[MongoDB] ========== updateAgentSkillInMongoDB END ==========`);
}

async function deleteAgentSkillFromMongoDB(
  id: string,
  user: { email: string; role?: string }
): Promise<void> {
  const collection = await getCollection<AgentSkill>("agent_skills");
  
  const existing = await collection.findOne({ id });
  if (!existing) {
    throw new ApiError("Agent config not found", 404);
  }
  
  // System configs cannot be deleted — they are managed via configuration
  if (existing.is_system) {
    throw new ApiError("Built-in skills cannot be deleted. Use the BUILTIN_SKILL_IDS configuration to control which built-in skills are enabled.", 403);
  }
  
  // Non-system configs can only be deleted by owner
  if (!existing.is_system && existing.owner_id !== user.email) {
    throw new ApiError("You don't have permission to delete this configuration", 403);
  }
  
  await collection.deleteOne({ id });

  await syncSkillResource("delete", id, existing.name);
}

async function getAgentSkillsFromMongoDB(
  ownerEmail: string,
  opts: { isAdmin: boolean; realmRoles: string[] }
): Promise<AgentSkill[]> {
  const collection = await getCollection<AgentSkill>("agent_skills");

  if (opts.isAdmin) {
    return collection.find({}).sort({ is_system: -1, created_at: -1 }).toArray();
  }

  const userTeamIds = await getUserTeamIds(ownerEmail);
  const { allGrantedSkillIds } = extractSkillAccessFromJwtRoles(opts.realmRoles);
  const roleClause =
    allGrantedSkillIds.length > 0 ? [{ id: { $in: allGrantedSkillIds } }] : [];

  const configs = await collection
    .find({
      $or: [
        { is_system: true },
        { owner_id: ownerEmail },
        { visibility: "global" },
        ...(userTeamIds.length > 0
          ? [{ visibility: "team" as const, shared_with_teams: { $in: userTeamIds } }]
          : []),
        ...roleClause,
      ],
    })
    .sort({ is_system: -1, created_at: -1 })
    .toArray();

  return configs;
}

async function getAgentSkillByIdFromMongoDB(
  id: string,
  ownerEmail: string,
  opts: { isAdmin: boolean; realmRoles: string[] }
): Promise<AgentSkill | null> {
  const collection = await getCollection<AgentSkill>("agent_skills");

  if (opts.isAdmin) {
    return collection.findOne({ id });
  }

  const userTeamIds = await getUserTeamIds(ownerEmail);
  const { allGrantedSkillIds } = extractSkillAccessFromJwtRoles(opts.realmRoles);
  const grantedByRole = new Set(allGrantedSkillIds);

  const config = await collection.findOne({
    id,
    $or: [
      { is_system: true },
      { owner_id: ownerEmail },
      { visibility: "global" },
      ...(userTeamIds.length > 0
        ? [{ visibility: "team" as const, shared_with_teams: { $in: userTeamIds } }]
        : []),
      ...(grantedByRole.has(id) ? [{ id }] : []),
    ],
  });

  return config;
}

// POST /api/agent-skills - Create a new agent config
export const POST = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Skills requires MongoDB to be configured", 503);
  }

  return await withAuth(request, async (req, user) => {
    const body: CreateAgentSkillInput = await request.json();

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

    const ancillaryCheck = validateAncillaryFiles(body.ancillary_files);

    const config: AgentSkill = {
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
      skill_content: body.skill_content,
      is_quick_start: body.is_quick_start,
      difficulty: body.difficulty,
      thumbnail: body.thumbnail,
      input_form: body.input_form,
      ancillary_files: body.ancillary_files,
    };

    const scanResult = await scanSkillContent(body.name, body.skill_content || "", id);
    config.scan_status = scanResult.scan_status;

    await saveAgentSkillToMongoDB(config);
    console.log(`[AgentSkill] Created agent config "${body.name}" by ${user.email} (visibility: ${visibility}, scan_status: ${scanResult.scan_status})`);

    await syncSkillResource("create", id, body.name, visibility);

    triggerSupervisorRefresh();

    return successResponse({
      id,
      message: "Agent config created successfully",
      scan_status: scanResult.scan_status,
      scan_summary: scanResult.scan_summary,
      ...(ancillaryCheck.warning ? { ancillary_warning: ancillaryCheck.warning } : {}),
    }, 201);
  });
});

// GET /api/agent-skills - Retrieve all agent configs (system + user's own)
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Skills requires MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  return await withAuth(request, async (req, user, session) => {
    const realmRoles = extractRealmRolesFromSession(session);
    const isAdmin = user.role === "admin";
    const listOpts = { isAdmin, realmRoles };

    if (id) {
      // Get single config by ID
      console.log(`[API GET] Fetching single config: ${id} for user: ${user.email}`);
      const config = await getAgentSkillByIdFromMongoDB(id, user.email, listOpts);
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
      const configs = await getAgentSkillsFromMongoDB(user.email, listOpts);
      console.log(`[API GET] Returning ${configs.length} configs`);
      return NextResponse.json(configs) as NextResponse;
    }
  });
});

// PUT /api/agent-skills?id=<configId> - Update an existing agent config
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
    
    const body: UpdateAgentSkillInput = await request.json();
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

    let ancillaryWarning: string | undefined;
    if (body.ancillary_files !== undefined) {
      const ancillaryCheck = validateAncillaryFiles(body.ancillary_files);
      ancillaryWarning = ancillaryCheck.warning;
    }

    if (body.skill_content !== undefined) {
      const scanResult = await scanSkillContent(
        body.name || id,
        body.skill_content || "",
        id,
      );
      (body as Record<string, unknown>).scan_status = scanResult.scan_status;
      console.log(`[API PUT] Scan result: ${scanResult.scan_status}`);
    }

    console.log(`[API PUT] Calling updateAgentSkillInMongoDB...`);
    await updateAgentSkillInMongoDB(id, body, user);
    console.log(`[AgentSkill] Updated agent config "${id}" by ${user.email}`);
    console.log(`[API PUT] ============ UPDATE REQUEST END ============`);

    triggerSupervisorRefresh();

    const scanStatus = (body as Record<string, unknown>).scan_status as ScanStatus | undefined;
    return successResponse({
      id,
      message: "Agent config updated successfully",
      ...(scanStatus ? { scan_status: scanStatus } : {}),
      ...(ancillaryWarning ? { ancillary_warning: ancillaryWarning } : {}),
    });
  });
});

// DELETE /api/agent-skills?id=<configId> - Delete an agent config
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
    await deleteAgentSkillFromMongoDB(id, user);
    console.log(`[AgentSkill] Deleted agent config "${id}" by ${user.email}`);

    triggerSupervisorRefresh();

    return successResponse({
      id,
      message: "Agent config deleted successfully",
    });
  });
});
