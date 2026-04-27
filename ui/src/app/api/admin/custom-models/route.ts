/**
 * GET/POST/PUT/DELETE /api/admin/custom-models
 *
 * Manages custom LLM model entries stored in MongoDB.
 * These are merged with the config.yaml model list at runtime, allowing admins
 * to add models (e.g. custom Azure deployments, private endpoints) without
 * editing the config file.
 *
 * DB-first / config-file-fallback: config.yaml models are always loaded at
 * Python backend startup; custom DB models are appended to that list.
 */

import { NextRequest } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  errorResponse,
  requireAdmin,
  ApiError,
} from '@/lib/api-middleware';
import { PROVIDER_DEFINITIONS } from '../llm-providers/route';

export interface CustomModel {
  model_id: string;    // Unique model identifier (e.g. deployment name for Azure)
  name: string;        // Human-readable display name
  provider: string;    // Must match a PROVIDER_DEFINITIONS id
  description: string;
}

// In 0.4.0, models are stored directly in the `llm_models` collection.
// Config-driven models (from seed YAML) have config_driven: true.
// Custom UI-added models have config_driven: false.
interface LLMModelDoc {
  _id: string;        // = model_id
  model_id: string;
  name: string;
  provider: string;
  description: string;
  config_driven: boolean;
  updated_at: string;
}

const MODELS_COLLECTION = 'llm_models';
const VALID_PROVIDERS = new Set(PROVIDER_DEFINITIONS.map(d => d.id));

function validateModel(m: Partial<CustomModel>): CustomModel {
  if (!m.model_id?.trim()) throw new ApiError('model_id is required', 400);
  if (!m.name?.trim()) throw new ApiError('name is required', 400);
  if (!m.provider?.trim()) throw new ApiError('provider is required', 400);
  if (!VALID_PROVIDERS.has(m.provider)) {
    throw new ApiError(`Unknown provider "${m.provider}". Valid: ${[...VALID_PROVIDERS].join(', ')}`, 400);
  }
  return {
    model_id: m.model_id.trim(),
    name: m.name.trim(),
    provider: m.provider.trim(),
    description: m.description?.trim() ?? '',
  };
}

// ---------------------------------------------------------------------------
// GET — list custom (non-config-driven) models
// ---------------------------------------------------------------------------

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return errorResponse('MongoDB not configured', 503, 'MONGODB_NOT_CONFIGURED');
  }
  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);
    const col = await getCollection<LLMModelDoc>(MODELS_COLLECTION);
    const models = await col.find({ config_driven: false }).sort({ name: 1 }).toArray();
    return successResponse({ models: models.map(m => ({
      model_id: m.model_id,
      name: m.name,
      provider: m.provider,
      description: m.description,
    })) });
  });
});

// ---------------------------------------------------------------------------
// POST — add a custom model to the llm_models collection
// ---------------------------------------------------------------------------

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return errorResponse('MongoDB not configured', 503, 'MONGODB_NOT_CONFIGURED');
  }
  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);
    const body = await request.json();
    const model = validateModel(body);

    const col = await getCollection<LLMModelDoc>(MODELS_COLLECTION);
    const existing = await col.findOne({ _id: model.model_id as any });
    if (existing) {
      throw new ApiError(`Model with id "${model.model_id}" already exists`, 409);
    }

    const doc: LLMModelDoc = {
      _id: model.model_id,
      model_id: model.model_id,
      name: model.name,
      provider: model.provider,
      description: model.description,
      config_driven: false,
      updated_at: new Date().toISOString(),
    };

    await col.insertOne(doc as any);
    return successResponse(model, 201);
  });
});

// ---------------------------------------------------------------------------
// PUT — update an existing custom model
// ---------------------------------------------------------------------------

export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return errorResponse('MongoDB not configured', 503, 'MONGODB_NOT_CONFIGURED');
  }
  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);
    const body = await request.json();
    const model = validateModel(body);

    const col = await getCollection<LLMModelDoc>(MODELS_COLLECTION);
    const existing = await col.findOne({ _id: model.model_id as any });
    if (!existing) throw new ApiError(`Model "${model.model_id}" not found`, 404);
    if (existing.config_driven) throw new ApiError('Cannot modify config-driven models', 403);

    await col.updateOne(
      { _id: model.model_id as any },
      { $set: { name: model.name, provider: model.provider, description: model.description, updated_at: new Date().toISOString() } },
    );

    return successResponse(model);
  });
});

// ---------------------------------------------------------------------------
// DELETE — remove a custom model
// ---------------------------------------------------------------------------

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return errorResponse('MongoDB not configured', 503, 'MONGODB_NOT_CONFIGURED');
  }
  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);
    const { searchParams } = new URL(request.url);
    const modelId = searchParams.get('model_id');
    if (!modelId) throw new ApiError('model_id query param required', 400);

    const col = await getCollection<LLMModelDoc>(MODELS_COLLECTION);
    const existing = await col.findOne({ _id: modelId as any });
    if (!existing) throw new ApiError(`Model "${modelId}" not found`, 404);
    if (existing.config_driven) throw new ApiError('Cannot delete config-driven models', 403);

    await col.deleteOne({ _id: modelId as any });
    return successResponse({ deleted: modelId });
  });
});
