/**
 * API route for listing available LLM models.
 *
 * Sources, in order:
 *   1. The supervisor's configured LLM, derived from `LLM_PROVIDER` +
 *      provider-specific env vars (so the model the supervisor already
 *      uses is always available to Custom Agents without extra setup).
 *   2. Models in the `llm_models` MongoDB collection (seeded at startup
 *      via instrumentation.ts from config.yaml, plus any added via the
 *      admin LLM Models tab).
 *
 * Entries are deduplicated by `model_id`; an explicit Mongo entry with
 * the same id wins over the env-derived default.
 */

import { NextRequest } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
} from "@/lib/api-middleware";
import { getDefaultLLMModelFromEnv } from "@/lib/default-llm-model";

interface ModelResponseEntry {
  model_id: string;
  name: string;
  provider: string;
  description: string;
}

/**
 * GET /api/dynamic-agents/models
 * List available LLM models for agent configuration.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async () => {
    const envDefault = getDefaultLLMModelFromEnv();

    let mongoModels: ModelResponseEntry[] = [];
    if (isMongoDBConfigured) {
      try {
        const collection = await getCollection("llm_models");
        const docs = await collection.find({}).sort({ name: 1 }).toArray();
        mongoModels = docs.map((m) => ({
          model_id: m.model_id,
          name: m.name,
          provider: m.provider,
          description: m.description ?? "",
        }));
      } catch (err) {
        // Don't fail the whole request if Mongo is configured but unreachable;
        // we can still return the env-derived default so the UI stays usable.
        console.error(
          "[api/dynamic-agents/models] failed to read llm_models:",
          err,
        );
      }
    }

    const seen = new Set(mongoModels.map((m) => m.model_id));
    const merged: ModelResponseEntry[] = [];
    if (envDefault && !seen.has(envDefault.model_id)) {
      merged.push(envDefault);
    }
    merged.push(...mongoModels);

    return successResponse(merged);
  });
});
