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
  TaskConfig,
  CreateTaskConfigInput,
  UpdateTaskConfigInput,
  TaskConfigVisibility,
} from "@/types/task-config";
import { extractEnvVars, toTaskConfigYamlFormat } from "@/types/task-config";
import { syncTaskResource } from "@/lib/rbac/keycloak-resource-sync";
import {
  extractRealmRolesFromSession,
  extractTaskAccessFromJwtRoles,
} from "@/lib/rbac/task-skill-realm-access";

/**
 * Task Config API Routes
 *
 * CRUD operations for task configs stored in the task_configs MongoDB collection.
 * These configs define self-service workflows consumed by the supervisor agent.
 *
 * System configs (seeded from task_config.yaml) can only be modified by admins.
 */

const STORAGE_TYPE = isMongoDBConfigured ? "mongodb" : "none";
const VALID_VISIBILITIES: TaskConfigVisibility[] = ["private", "team", "global"];

function isUserAdmin(user: { email: string; role?: string }): boolean {
  return user.role === "admin";
}

async function saveTaskConfig(config: TaskConfig): Promise<void> {
  const collection = await getCollection<TaskConfig>("task_configs");
  await collection.insertOne(config);
}

async function updateTaskConfig(
  id: string,
  updates: Partial<TaskConfig>,
  user: { email: string; role?: string }
): Promise<void> {
  const collection = await getCollection<TaskConfig>("task_configs");
  const existing = await collection.findOne({ id });

  if (!existing) {
    throw new ApiError("Task config not found", 404);
  }

  if (existing.is_system && !isUserAdmin(user)) {
    throw new ApiError("Only admins can modify system task configurations", 403);
  }

  if (!existing.is_system && existing.owner_id !== user.email) {
    throw new ApiError("You don't have permission to update this task config", 403);
  }

  await collection.updateOne(
    { id },
    { $set: { ...updates, updated_at: new Date() } }
  );
}

async function deleteTaskConfig(
  id: string,
  user: { email: string; role?: string }
): Promise<void> {
  const collection = await getCollection<TaskConfig>("task_configs");
  const existing = await collection.findOne({ id });

  if (!existing) {
    throw new ApiError("Task config not found", 404);
  }

  if (existing.is_system && !isUserAdmin(user)) {
    throw new ApiError("Only admins can delete system task configurations", 403);
  }

  if (!existing.is_system && existing.owner_id !== user.email) {
    throw new ApiError("You don't have permission to delete this task config", 403);
  }

  await collection.deleteOne({ id });

  if (!existing.is_system) {
    await syncTaskResource("delete", id, existing.name);
  }
}

async function getTaskConfigs(
  ownerEmail: string,
  opts: { isAdmin: boolean; realmRoles: string[] }
): Promise<TaskConfig[]> {
  const collection = await getCollection<TaskConfig>("task_configs");

  if (opts.isAdmin) {
    return collection
      .find({})
      .sort({ is_system: -1, category: 1, name: 1 })
      .toArray();
  }

  const userTeamIds = await getUserTeamIds(ownerEmail);
  const { allGrantedTaskIds } = extractTaskAccessFromJwtRoles(opts.realmRoles);
  const roleClause =
    allGrantedTaskIds.length > 0 ? [{ id: { $in: allGrantedTaskIds } }] : [];

  return collection
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
    .sort({ is_system: -1, category: 1, name: 1 })
    .toArray();
}

async function getTaskConfigById(
  id: string,
  ownerEmail: string,
  opts: { isAdmin: boolean; realmRoles: string[] }
): Promise<TaskConfig | null> {
  const collection = await getCollection<TaskConfig>("task_configs");

  if (opts.isAdmin) {
    return collection.findOne({ id });
  }

  const userTeamIds = await getUserTeamIds(ownerEmail);
  const { allGrantedTaskIds } = extractTaskAccessFromJwtRoles(opts.realmRoles);
  const grantedByRole = new Set(allGrantedTaskIds);

  return collection.findOne({
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
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Task Builder requires MongoDB to be configured", 503);
  }

  return await withAuth(request, async (_req, user) => {
    const body: CreateTaskConfigInput = await request.json();

    if (!body.name || !body.category || !body.tasks || body.tasks.length === 0) {
      throw new ApiError(
        "Missing required fields: name, category, and at least one task are required",
        400
      );
    }

    for (const task of body.tasks) {
      if (!task.display_text || !task.llm_prompt || !task.subagent) {
        throw new ApiError(
          "Each task must have display_text, llm_prompt, and subagent",
          400
        );
      }
    }

    const visibility: TaskConfigVisibility = body.visibility || "private";
    if (!VALID_VISIBILITIES.includes(visibility)) {
      throw new ApiError(
        `Invalid visibility: ${visibility}. Must be one of: ${VALID_VISIBILITIES.join(", ")}`,
        400
      );
    }
    if (
      visibility === "team" &&
      (!body.shared_with_teams || body.shared_with_teams.length === 0)
    ) {
      throw new ApiError(
        "At least one team must be selected when visibility is 'team'",
        400
      );
    }

    const id = `task-config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();

    const config: TaskConfig = {
      id,
      name: body.name,
      category: body.category,
      description: body.description,
      tasks: body.tasks,
      owner_id: user.email,
      is_system: false,
      visibility,
      shared_with_teams:
        visibility === "team" ? body.shared_with_teams : undefined,
      metadata: {
        ...body.metadata,
        env_vars_required: extractEnvVars(body.tasks),
      },
      created_at: now,
      updated_at: now,
    };

    await saveTaskConfig(config);

    await syncTaskResource("create", id, body.name, visibility);

    return successResponse({ id, message: "Task config created successfully" }, 201);
  });
});

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Task Builder requires MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const format = searchParams.get("format");

  return await withAuth(request, async (_req, user, session) => {
    const realmRoles = extractRealmRolesFromSession(session);
    const isAdmin = user.role === "admin";
    const listOpts = { isAdmin, realmRoles };

    if (id) {
      const config = await getTaskConfigById(id, user.email, listOpts);
      if (!config) {
        throw new ApiError("Task config not found", 404);
      }
      return NextResponse.json(config) as NextResponse;
    }

    const configs = await getTaskConfigs(user.email, listOpts);

    if (format === "yaml") {
      const yamlObj = toTaskConfigYamlFormat(configs);
      return NextResponse.json(yamlObj) as NextResponse;
    }

    return NextResponse.json(configs) as NextResponse;
  });
});

export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Task Builder requires MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Task config ID is required", 400);
  }

  return await withAuth(request, async (_req, user) => {
    const body: UpdateTaskConfigInput = await request.json();

    if (Object.keys(body).length === 0) {
      throw new ApiError(
        "At least one field must be provided for update",
        400
      );
    }

    if (body.visibility !== undefined) {
      if (!VALID_VISIBILITIES.includes(body.visibility)) {
        throw new ApiError(
          `Invalid visibility: ${body.visibility}. Must be one of: ${VALID_VISIBILITIES.join(", ")}`,
          400
        );
      }
      if (
        body.visibility === "team" &&
        (!body.shared_with_teams || body.shared_with_teams.length === 0)
      ) {
        throw new ApiError(
          "At least one team must be selected when visibility is 'team'",
          400
        );
      }
      if (body.visibility !== "team") {
        body.shared_with_teams = undefined;
      }
    }

    if (body.tasks) {
      if (body.tasks.length === 0) {
        throw new ApiError("At least one task is required", 400);
      }
      for (const task of body.tasks) {
        if (!task.display_text || !task.llm_prompt || !task.subagent) {
          throw new ApiError(
            "Each task must have display_text, llm_prompt, and subagent",
            400
          );
        }
      }
    }

    await updateTaskConfig(id, body, user);

    return successResponse({ id, message: "Task config updated successfully" });
  });
});

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Task Builder requires MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Task config ID is required", 400);
  }

  return await withAuth(request, async (_req, user) => {
    await deleteTaskConfig(id, user);
    return successResponse({ id, message: "Task config deleted successfully" });
  });
});
