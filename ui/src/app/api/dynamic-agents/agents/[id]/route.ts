/**
 * API route for fetching a single dynamic agent by ID.
 *
 * GET /api/dynamic-agents/agents/[id]
 * Returns the agent configuration if the user has access to it.
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withErrorHandler,
  successResponse,
  ApiError,
  getAuthFromBearerOrSession,
} from "@/lib/api-middleware";
import { requireAgentPermission } from "@/lib/rbac/resource-authz";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

const COLLECTION_NAME = "dynamic_agents";

/**
 * GET /api/dynamic-agents/agents/[id]
 * Fetch a single dynamic agent by ID.
 * Returns 404 if not found or user doesn't have access.
 */
export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await context.params;

    if (!id) {
      throw new ApiError("Agent ID is required", 400);
    }

    const { session } = await getAuthFromBearerOrSession(request);

      const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

      // Find the agent
      const agent = await collection.findOne({ _id: id });

      if (!agent) {
        throw new ApiError("Agent not found", 404);
      }

      try {
        await requireAgentPermission(session, id, "read");
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (!statusCode || (statusCode !== 403 && statusCode !== 404)) throw error;
        throw new ApiError("Agent not found", 404);
      }

      // Normalize legacy model_id/model_provider → model
      const doc = agent as unknown as Record<string, unknown>;
      if (doc.model_id && !doc.model) {
        doc.model = { id: doc.model_id, provider: doc.model_provider || "unknown" };
        delete doc.model_id;
        delete doc.model_provider;
      }

      return successResponse(doc);
  }
);
