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
import { scanSkillContent as runSkillScan } from "@/lib/skill-scan";
import { recordScanEvent } from "@/lib/skill-scan-history";
import { getAgentSkillVisibleToUser } from "@/lib/agent-skill-visibility";

/**
 * Persisted agent skill configs (CRUD)
 *
 * Storage: MongoDB collection `agent_skills`
 *
 * - User ownership (`owner_id`); built-in rows (`is_system`) editable/deletable by any authenticated user (restore via import/seed)
 * - Catalog browse remains GET `/api/skills` (merged view), not this route
 *
 * HTTP: GET/POST/PUT/DELETE `/api/skills/configs`
 */

const STORAGE_TYPE = isMongoDBConfigured ? "mongodb" : "none";
const SUPERVISOR_URL = process.env.NEXT_PUBLIC_A2A_BASE_URL || "";

const ANCILLARY_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB soft limit (FR-028)

function triggerSupervisorRefresh(): void {
  if (!SUPERVISOR_URL) return;
  const url = `${SUPERVISOR_URL}/skills/refresh?include_hubs=false`;
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

function isUserAdmin(user: { email: string; role?: string }): boolean {
  return user.role === "admin";
}

const VALID_VISIBILITIES: SkillVisibility[] = ["private", "team", "global"];

async function saveAgentSkillToMongoDB(config: AgentSkill): Promise<void> {
  const collection = await getCollection<AgentSkill>("agent_skills");
  await collection.insertOne(config);
}

async function updateAgentSkillInMongoDB(
  id: string,
  updates: Partial<AgentSkill>,
  user: { email: string; role?: string },
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
    tasks_count: existing?.tasks?.length,
  });

  if (!existing) {
    console.log(`[MongoDB] ERROR: Config not found`);
    throw new ApiError("Agent config not found", 404);
  }

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
  const updateResult = await collection.updateOne({ id }, { $set: updatePayload });
  console.log(`[MongoDB] UpdateOne result:`, {
    matchedCount: updateResult.matchedCount,
    modifiedCount: updateResult.modifiedCount,
    acknowledged: updateResult.acknowledged,
  });

  console.log(`[MongoDB] Fetching updated config for verification...`);
  const updated = await collection.findOne({ id });
  console.log(`[MongoDB] Verified updated config:`, {
    id: updated?.id,
    name: updated?.name,
    tasks_count: updated?.tasks?.length,
    updated_at: updated?.updated_at,
  });
  if (updated?.tasks && updated.tasks.length > 0) {
    console.log(`[MongoDB] First task after update:`, {
      display_text: updated.tasks[0].display_text,
      llm_prompt: updated.tasks[0].llm_prompt,
      subagent: updated.tasks[0].subagent,
    });
  }
  console.log(`[MongoDB] ========== updateAgentSkillInMongoDB END ==========`);
}

async function deleteAgentSkillFromMongoDB(
  id: string,
  user: { email: string; role?: string },
): Promise<void> {
  const collection = await getCollection<AgentSkill>("agent_skills");

  const existing = await collection.findOne({ id });
  if (!existing) {
    throw new ApiError("Agent config not found", 404);
  }

  if (!existing.is_system && existing.owner_id !== user.email) {
    throw new ApiError("You don't have permission to delete this configuration", 403);
  }

  await collection.deleteOne({ id });
}

async function getAgentSkillsFromMongoDB(ownerEmail: string): Promise<AgentSkill[]> {
  const collection = await getCollection<AgentSkill>("agent_skills");
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

// POST /api/skills/configs
export const POST = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Skills requires MongoDB to be configured", 503);
  }

  return await withAuth(request, async (req, user) => {
    const body: CreateAgentSkillInput = await request.json();

    if (!body.name || !body.category || !body.tasks || body.tasks.length === 0) {
      throw new ApiError("Missing required fields: name, category, and at least one task are required", 400);
    }

    for (const task of body.tasks) {
      if (!task.display_text || !task.llm_prompt || !task.subagent) {
        throw new ApiError("Each task must have display_text, llm_prompt, and subagent", 400);
      }
    }

    const visibility: SkillVisibility = body.visibility || "private";
    if (!VALID_VISIBILITIES.includes(visibility)) {
      throw new ApiError(`Invalid visibility: ${visibility}. Must be one of: ${VALID_VISIBILITIES.join(", ")}`, 400);
    }
    if (visibility === "team" && (!body.shared_with_teams || body.shared_with_teams.length === 0)) {
      throw new ApiError("At least one team must be selected when visibility is 'team'", 400);
    }

    const nameSlug = (body.name as string)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const id = `skill-${nameSlug}-${Math.random().toString(36).substr(2, 9)}`;
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

    const tCreate = Date.now();
    const scanResult = await runSkillScan(body.name, body.skill_content || "", id);
    config.scan_status = scanResult.scan_status;
    if (scanResult.scan_summary !== undefined) {
      config.scan_summary = scanResult.scan_summary;
    }
    if (body.skill_content?.trim()) {
      config.scan_updated_at = new Date();
    }
    await recordScanEvent({
      trigger: "auto_save",
      skill_id: id,
      skill_name: body.name,
      source: "agent_skills",
      actor: user.email,
      scan_status: scanResult.scan_status,
      scan_summary: scanResult.scan_summary,
      scanner_unavailable: !body.skill_content?.trim() || scanResult.scan_status === "unscanned",
      duration_ms: Date.now() - tCreate,
    });

    await saveAgentSkillToMongoDB(config);
    console.log(
      `[AgentSkill] Created agent config "${body.name}" by ${user.email} (visibility: ${visibility}, scan_status: ${scanResult.scan_status})`,
    );

    triggerSupervisorRefresh();

    return successResponse(
      {
        id,
        message: "Agent config created successfully",
        scan_status: scanResult.scan_status,
        scan_summary: scanResult.scan_summary,
        ...(ancillaryCheck.warning ? { ancillary_warning: ancillaryCheck.warning } : {}),
      },
      201,
    );
  });
});

// GET /api/skills/configs
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Skills requires MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  return await withAuth(request, async (req, user) => {
    if (id) {
      console.log(`[API GET] Fetching single config: ${id} for user: ${user.email}`);
      const config = await getAgentSkillVisibleToUser(id, user.email);
      if (!config) {
        console.log(`[API GET] Config not found: ${id}`);
        throw new ApiError("Agent config not found", 404);
      }
      console.log(`[API GET] Returning config:`, {
        id: config.id,
        name: config.name,
        tasks_count: config.tasks?.length,
        updated_at: config.updated_at,
      });
      if (config.tasks && config.tasks.length > 0) {
        console.log(`[API GET] First task llm_prompt:`, config.tasks[0].llm_prompt);
      }
      return NextResponse.json(config) as NextResponse;
    } else {
      console.log(`[API GET] Fetching all configs for user: ${user.email}`);
      const configs = await getAgentSkillsFromMongoDB(user.email);
      console.log(`[API GET] Returning ${configs.length} configs`);
      return NextResponse.json(configs) as NextResponse;
    }
  });
});

// PUT /api/skills/configs?id=<configId>
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

    if (Object.keys(body).length === 0) {
      throw new ApiError("At least one field must be provided for update", 400);
    }

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
      console.log(`[API PUT] First task llm_prompt:`, body.tasks[0].llm_prompt);
    }

    let ancillaryWarning: string | undefined;
    if (body.ancillary_files !== undefined) {
      const ancillaryCheck = validateAncillaryFiles(body.ancillary_files);
      ancillaryWarning = ancillaryCheck.warning;
    }

    let scanSummaryFromSave: string | undefined;
    if (body.skill_content !== undefined) {
      const tPut = Date.now();
      const scanResult = await runSkillScan(body.name || id, body.skill_content || "", id);
      (body as Record<string, unknown>).scan_status = scanResult.scan_status;
      if (scanResult.scan_summary !== undefined) {
        (body as Record<string, unknown>).scan_summary = scanResult.scan_summary;
        scanSummaryFromSave = scanResult.scan_summary;
      }
      if (body.skill_content?.trim()) {
        (body as Record<string, unknown>).scan_updated_at = new Date();
      }
      console.log(`[API PUT] Scan result: ${scanResult.scan_status}`);
      await recordScanEvent({
        trigger: "auto_save",
        skill_id: id,
        skill_name: body.name || id,
        source: "agent_skills",
        actor: user.email,
        scan_status: scanResult.scan_status,
        scan_summary: scanResult.scan_summary,
        scanner_unavailable: !body.skill_content?.trim() || scanResult.scan_status === "unscanned",
        duration_ms: Date.now() - tPut,
      });
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
      ...(scanSummaryFromSave !== undefined ? { scan_summary: scanSummaryFromSave } : {}),
      ...(ancillaryWarning ? { ancillary_warning: ancillaryWarning } : {}),
    });
  });
});

// DELETE /api/skills/configs?id=<configId>
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
