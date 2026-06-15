/**
 * API route for listing available LLM models.
 *
 * Reads from the llm_models MongoDB collection (seeded at startup
 * via instrumentation.ts from config.yaml).
 */

import {
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { filterResourcesByPermission } from "@/lib/rbac/resource-authz";
import { NextRequest } from "next/server";

/**
 * GET /api/dynamic-agents/models
 * List available LLM models for agent configuration.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);

    const collection = await getCollection("llm_models");
    const models = await collection.find({}).sort({ name: 1 }).toArray();
    const visibleModels = await filterResourcesByPermission(session, models, {
      type: "llm_model",
      action: "read",
      id: (model) => String(model._id),
    });

    return successResponse(
      visibleModels.map((m) => ({
        model_id: m.model_id,
        name: m.name,
        provider: m.provider,
        description: m.description ?? "",
      })),
    );
});
