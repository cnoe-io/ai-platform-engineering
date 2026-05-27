import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import type {
  WorkflowRun,
  CreateWorkflowRunInput,
  UpdateWorkflowRunInput,
} from "@/types/workflow-run";

/**
 * Workflow Runs API Routes
 *
 * Storage: MongoDB only
 * 
 * Features:
 * - Track workflow execution history
 * - User ownership tracking (owner_id)
 * - CRUD operations for workflow runs
 * - Filtering by workflow_id, status, date range
 */

// Storage configuration - MongoDB only
const STORAGE_TYPE = isMongoDBConfigured ? "mongodb" : "none";

/**
 * MongoDB storage functions
 */
async function saveWorkflowRunToMongoDB(run: WorkflowRun): Promise<void> {
  const collection = await getCollection<WorkflowRun>("workflow_runs");
  await collection.insertOne(run);
}

async function updateWorkflowRunInMongoDB(
  id: string,
  updates: Partial<WorkflowRun>,
  ownerEmail: string
): Promise<void> {
  const collection = await getCollection<WorkflowRun>("workflow_runs");
  
  console.log(`[updateWorkflowRunInMongoDB] Finding run ${id} for owner ${ownerEmail}`);
  const existing = await collection.findOne({ id });
  if (!existing) {
    console.error(`[updateWorkflowRunInMongoDB] Run ${id} not found`);
    throw new ApiError("Workflow run not found", 404);
  }
  
  console.log(`[updateWorkflowRunInMongoDB] Found run ${id}, current status: ${existing.status}`);
  
  // Only owner can update
  if (existing.owner_id !== ownerEmail) {
    console.error(`[updateWorkflowRunInMongoDB] Permission denied: ${existing.owner_id} !== ${ownerEmail}`);
    throw new ApiError("You don't have permission to update this workflow run", 403);
  }
  
  console.log(`[updateWorkflowRunInMongoDB] Updating run ${id} with:`, updates);
  const result = await collection.updateOne(
    { id },
    { $set: updates }
  );
  console.log(`[updateWorkflowRunInMongoDB] ✅ Update result - matched: ${result.matchedCount}, modified: ${result.modifiedCount}`);
  
  // Verify the update
  const updated = await collection.findOne({ id });
  console.log(`[updateWorkflowRunInMongoDB] Updated run status is now: ${updated?.status}`);
}

async function deleteWorkflowRunFromMongoDB(
  id: string,
  ownerEmail: string
): Promise<void> {
  const collection = await getCollection<WorkflowRun>("workflow_runs");
  
  const existing = await collection.findOne({ id });
  if (!existing) {
    throw new ApiError("Workflow run not found", 404);
  }
  
  // Only owner can delete
  if (existing.owner_id !== ownerEmail) {
    throw new ApiError("You don't have permission to delete this workflow run", 403);
  }
  
  await collection.deleteOne({ id });
}

async function getWorkflowRunsFromMongoDB(
  ownerEmail: string,
  filters?: {
    workflow_id?: string;
    status?: string;
    limit?: number;
  }
): Promise<WorkflowRun[]> {
  const collection = await getCollection<WorkflowRun>("workflow_runs");
  
  const query: any = { owner_id: ownerEmail };
  
  if (filters?.workflow_id) {
    query.workflow_id = filters.workflow_id;
  }
  
  if (filters?.status) {
    query.status = filters.status;
  }
  
  const limit = filters?.limit || 100;
  
  const runs = await collection
    .find(query)
    .sort({ started_at: -1 })
    .limit(limit)
    .toArray();
  
  return runs;
}

async function getWorkflowRunByIdFromMongoDB(
  id: string,
  ownerEmail: string
): Promise<WorkflowRun | null> {
  const collection = await getCollection<WorkflowRun>("workflow_runs");
  
  const run = await collection.findOne({
    id,
    owner_id: ownerEmail,
  });
  
  return run;
}

// POST /api/workflow-runs - Create a new workflow run
export const POST = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Workflow run history requires MongoDB to be configured", 503);
  }

  return await withAuth(request, async (req, user) => {
    const body: CreateWorkflowRunInput = await request.json();

    // Validate required fields
    if (!body.workflow_id || !body.workflow_name) {
      throw new ApiError("Missing required fields: workflow_id and workflow_name are required", 400);
    }

    // Generate ID
    const id = `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();

    const run: WorkflowRun = {
      id,
      workflow_id: body.workflow_id,
      workflow_name: body.workflow_name,
      workflow_category: body.workflow_category,
      status: "running",
      started_at: now,
      input_parameters: body.input_parameters,
      input_prompt: body.input_prompt,
      owner_id: user.email,
      created_at: now,
      metadata: body.metadata,
    };

    await saveWorkflowRunToMongoDB(run);
    console.log(`[WorkflowRun] Created workflow run "${id}" for workflow "${body.workflow_name}" by ${user.email}`);

    return successResponse({
      id,
      message: "Workflow run created successfully",
    }, 201);
  });
});

// GET /api/workflow-runs - Retrieve workflow runs
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Workflow run history requires MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const workflow_id = searchParams.get("workflow_id");
  const status = searchParams.get("status");
  const limit = searchParams.get("limit");

  return await withAuth(request, async (req, user) => {
    if (id) {
      // Get single run by ID
      const run = await getWorkflowRunByIdFromMongoDB(id, user.email);
      if (!run) {
        throw new ApiError("Workflow run not found", 404);
      }
      return NextResponse.json(run) as NextResponse;
    } else {
      // Get all runs with optional filters
      const runs = await getWorkflowRunsFromMongoDB(user.email, {
        workflow_id: workflow_id || undefined,
        status: status || undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      return NextResponse.json(runs) as NextResponse;
    }
  });
});

// PUT /api/workflow-runs?id=<runId> - Update an existing workflow run
export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Workflow run history requires MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Workflow run ID is required", 400);
  }

  return await withAuth(request, async (req, user) => {
    const body: UpdateWorkflowRunInput = await request.json();

    // Validate that at least one field is provided
    if (Object.keys(body).length === 0) {
      throw new ApiError("At least one field must be provided for update", 400);
    }

    await updateWorkflowRunInMongoDB(id, body, user.email);
    console.log(`[WorkflowRun] Updated workflow run "${id}" by ${user.email}`);

    return successResponse({
      id,
      message: "Workflow run updated successfully",
    });
  });
});

// DELETE /api/workflow-runs?id=<runId> - Delete a workflow run
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("Workflow run history requires MongoDB to be configured", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Workflow run ID is required", 400);
  }

  return await withAuth(request, async (req, user) => {
    await deleteWorkflowRunFromMongoDB(id, user.email);
    console.log(`[WorkflowRun] Deleted workflow run "${id}" by ${user.email}`);

    return successResponse({
      id,
      message: "Workflow run deleted successfully",
    });
  });
});
