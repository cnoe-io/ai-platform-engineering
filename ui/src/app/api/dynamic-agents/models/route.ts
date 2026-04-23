/**
 * API route for listing available LLM models.
 *
 * Reads from the llm_models MongoDB collection (seeded at startup
 * via instrumentation.ts from config.yaml).
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
} from "@/lib/api-middleware";

/**
 * GET /api/dynamic-agents/models
 * List available LLM models for agent configuration.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async () => {
    const collection = await getCollection("llm_models");
    const models = await collection.find({}).sort({ name: 1 }).toArray();

    return successResponse(
      models.map((m) => ({
        model_id: m.model_id,
        name: m.name,
        provider: m.provider,
        description: m.description ?? "",
        // Surface whether this row came from the IaC seed (config.yaml) or was
        // added via the UI. Lets the Available Models panel render a single
        // deduplicated list with a source badge per row, instead of calling
        // two endpoints and duplicating whatever they have in common.
        config_driven: m.config_driven === true,
      })),
    );
  });
});
