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
  WorkflowConfig,
  CreateWorkflowConfigInput,
  UpdateWorkflowConfigInput,
  WorkflowConfigVisibility,
  StepEntry,
} from "@/types/workflow-config";

/**
 * Workflow Config API Routes
 *
 * CRUD operations for workflow configs stored in the workflow_configs MongoDB collection.
 * These configs define multi-step workflows executed by the Workflow Service
 * against dynamic agents via AG-UI.
 */

const STORAGE_TYPE = isMongoDBConfigured ? "mongodb" : "none";
const VALID_VISIBILITIES: WorkflowConfigVisibility[] = ["private", "team", "global"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateSteps(steps: StepEntry[]): void {
  if (!steps || steps.length === 0) {
    throw new ApiError("At least one step is required", 400);
  }
  for (const entry of steps) {
    if (entry.type === "parallel") {
      throw new ApiError(
        "Parallel groups are not supported in v1. All steps must have type 'step'.",
        400
      );
    }
    if (entry.type !== "step") {
      throw new ApiError(`Unknown step type: ${(entry as any).type}`, 400);
    }
    if (!entry.display_text || !entry.agent_id || !entry.prompt) {
      throw new ApiError(
        "Each step must have display_text, agent_id, and prompt",
        400
      );
    }
    if (entry.on_error === "retry" && (!entry.retry || entry.retry.max_attempts < 1)) {
      throw new ApiError(
        "Steps with on_error='retry' must have retry.max_attempts >= 1",
        400
      );
    }
  }
}

function validateVisibility(
  visibility: WorkflowConfigVisibility | undefined,
  sharedWithTeams: string[] | undefined
): void {
  if (visibility !== undefined) {
    if (!VALID_VISIBILITIES.includes(visibility)) {
      throw new ApiError(
        `Invalid visibility: ${visibility}. Must be one of: ${VALID_VISIBILITIES.join(", ")}`,
        400
      );
    }
    if (visibility === "team" && (!sharedWithTeams || sharedWithTeams.length === 0)) {
      throw new ApiError(
        "At least one team must be selected when visibility is 'team'",
        400
      );
    }
  }
}

async function getVisibleConfigs(ownerEmail: string): Promise<WorkflowConfig[]> {
  const collection = await getCollection<WorkflowConfig>("workflow_configs");
  const userTeamIds = await getUserTeamIds(ownerEmail);

  return collection
    .find({
      $or: [
        { owner_id: ownerEmail },
        { visibility: "global" },
        ...(userTeamIds.length > 0
          ? [{ visibility: "team" as const, shared_with_teams: { $in: userTeamIds } }]
          : []),
      ],
    })
    .sort({ name: 1 })
    .toArray();
}

async function getVisibleConfigById(
  id: string,
  ownerEmail: string
): Promise<WorkflowConfig | null> {
  const collection = await getCollection<WorkflowConfig>("workflow_configs");
  const userTeamIds = await getUserTeamIds(ownerEmail);

  return collection.findOne({
    _id: id,
    $or: [
      { owner_id: ownerEmail },
      { visibility: "global" },
      ...(userTeamIds.length > 0
        ? [{ visibility: "team" as const, shared_with_teams: { $in: userTeamIds } }]
        : []),
    ],
  });
}

// ---------------------------------------------------------------------------
// GET — list all visible configs, or get one by ?id=
// ---------------------------------------------------------------------------

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Workflows require MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  return await withAuth(request, async (_req, user) => {
    if (id) {
      const config = await getVisibleConfigById(id, user.email);
      if (!config) {
        throw new ApiError("Workflow config not found", 404);
      }
      return NextResponse.json(config) as NextResponse;
    }

    const configs = await getVisibleConfigs(user.email);
    return NextResponse.json(configs) as NextResponse;
  });
});

// ---------------------------------------------------------------------------
// POST — create a new workflow config
// ---------------------------------------------------------------------------

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Workflows require MongoDB to be configured", 503);
  }

  return await withAuth(request, async (_req, user) => {
    const body: CreateWorkflowConfigInput = await request.json();

    if (!body.name) {
      throw new ApiError("Missing required field: name", 400);
    }

    validateSteps(body.steps);
    const visibility: WorkflowConfigVisibility = body.visibility || "private";
    validateVisibility(visibility, body.shared_with_teams);

    const id = `wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();

    const config = {
      _id: id,
      name: body.name,
      description: body.description,
      steps: body.steps,
      owner_id: user.email,
      visibility,
      shared_with_teams: visibility === "team" ? body.shared_with_teams : undefined,
      created_at: now,
      updated_at: now,
    };

    const collection = await getCollection("workflow_configs");
    await collection.insertOne(config as any);

    return successResponse({ id, message: "Workflow config created successfully" }, 201);
  });
});

// ---------------------------------------------------------------------------
// PUT — update an existing workflow config (?id=)
// ---------------------------------------------------------------------------

export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Workflows require MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    throw new ApiError("Workflow config ID is required", 400);
  }

  return await withAuth(request, async (_req, user) => {
    const body: UpdateWorkflowConfigInput = await request.json();

    if (Object.keys(body).length === 0) {
      throw new ApiError("At least one field must be provided for update", 400);
    }

    const collection = await getCollection<WorkflowConfig>("workflow_configs");
    const existing = await collection.findOne({ _id: id as any });

    if (!existing) {
      throw new ApiError("Workflow config not found", 404);
    }
    if (existing.owner_id !== user.email && user.role !== "admin") {
      throw new ApiError("You don't have permission to update this workflow config", 403);
    }

    if (body.steps) {
      validateSteps(body.steps);
    }
    if (body.visibility !== undefined) {
      validateVisibility(body.visibility, body.shared_with_teams);
      if (body.visibility !== "team") {
        body.shared_with_teams = undefined;
      }
    }

    await collection.updateOne(
      { _id: id as any },
      { $set: { ...body, updated_at: new Date() } }
    );

    return successResponse({ id, message: "Workflow config updated successfully" });
  });
});

// ---------------------------------------------------------------------------
// DELETE — delete a workflow config (?id=)
// ---------------------------------------------------------------------------

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Workflows require MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    throw new ApiError("Workflow config ID is required", 400);
  }

  return await withAuth(request, async (_req, user) => {
    const collection = await getCollection<WorkflowConfig>("workflow_configs");
    const existing = await collection.findOne({ _id: id as any });

    if (!existing) {
      throw new ApiError("Workflow config not found", 404);
    }
    if (existing.owner_id !== user.email && user.role !== "admin") {
      throw new ApiError("You don't have permission to delete this workflow config", 403);
    }

    await collection.deleteOne({ _id: id as any });
    return successResponse({ id, message: "Workflow config deleted successfully" });
  });
});
