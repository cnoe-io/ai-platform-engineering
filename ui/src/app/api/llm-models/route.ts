/**
 * API routes for LLM Model management.
 *
 * CRUD operations on the llm_models MongoDB collection.
 * Config-driven models (seeded from app-config.yaml) cannot be
 * edited or deleted.
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  requireAdmin,
  getPaginationParams,
  paginatedResponse,
} from "@/lib/api-middleware";
import type { LLMModelConfig } from "@/types/dynamic-agent";

const COLLECTION_NAME = "llm_models";

/** Fields allowed in create/update requests. */
const MODEL_MUTABLE_FIELDS = [
  "name",
  "provider",
  "description",
] as const;

function pickMutableFields(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of MODEL_MUTABLE_FIELDS) {
    if (body[field] !== undefined) {
      result[field] = body[field];
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// GET — list LLM models
// ═══════════════════════════════════════════════════════════════

export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async () => {
    const { page, pageSize } = getPaginationParams(request);

    const collection = await getCollection<LLMModelConfig>(COLLECTION_NAME);
    const total = await collection.countDocuments();
    const items = await collection
      .find({})
      .sort({ name: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();

    return paginatedResponse(items, total, page, pageSize);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST — create LLM model
// ═══════════════════════════════════════════════════════════════

export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const body = await request.json();
    const { model_id, name, provider } = body;

    if (!model_id || !name || !provider) {
      throw new ApiError("model_id, name, and provider are required", 400);
    }

    // Slug validation
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(model_id)) {
      throw new ApiError(
        "model_id must start with alphanumeric and contain only alphanumeric, dots, slashes, hyphens, underscores",
        400,
      );
    }

    const collection = await getCollection<LLMModelConfig>(COLLECTION_NAME);

    // Check for duplicate
    const existing = await collection.findOne({ _id: model_id });
    if (existing) {
      throw new ApiError(`Model '${model_id}' already exists`, 409);
    }

    const now = new Date().toISOString();
    const doc = {
      _id: model_id,
      model_id,
      name,
      provider,
      description: body.description ?? "",
      config_driven: false,
      updated_at: now,
    };

    await collection.insertOne(doc as any);

    return successResponse(doc, 201);
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT — update LLM model
// ═══════════════════════════════════════════════════════════════

export const PUT = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, _user, session) => {
    requireAdmin(session);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) throw new ApiError("id query parameter is required", 400);

    const collection = await getCollection<LLMModelConfig>(COLLECTION_NAME);
    const existing = await collection.findOne({ _id: id });

    if (!existing) throw new ApiError("Model not found", 404);
    if (existing.config_driven) {
      throw new ApiError("Config-driven models cannot be edited", 403);
    }

    const body = await request.json();
    const updates = pickMutableFields(body);

    if (Object.keys(updates).length === 0) {
      throw new ApiError("No valid fields to update", 400);
    }

    updates.updated_at = new Date().toISOString();

    await collection.updateOne({ _id: id }, { $set: updates });
    const updated = await collection.findOne({ _id: id });

    return successResponse(updated);
  });
});

// ═══════════════════════════════════════════════════════════════
// DELETE — remove LLM model
// ═══════════════════════════════════════════════════════════════

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, _user, session) => {
    requireAdmin(session);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) throw new ApiError("id query parameter is required", 400);

    const collection = await getCollection<LLMModelConfig>(COLLECTION_NAME);
    const existing = await collection.findOne({ _id: id });

    if (!existing) throw new ApiError("Model not found", 404);
    if (existing.config_driven) {
      throw new ApiError("Config-driven models cannot be deleted", 403);
    }

    await collection.deleteOne({ _id: id });

    return successResponse({ deleted: true });
  });
});
