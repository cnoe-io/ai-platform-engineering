/**
 * GET /api/rag/sources/[sourceId] — fetch a single ingestion-source config
 * record (spec 2026-07-21-rag-source-config-db).
 *
 * 403 (not 404) for an existing-but-unreadable record — matches
 * `ui/src/app/api/rag/kbs/[id]/sharing/route.ts`'s GET, which lets
 * `requireResourcePermission`'s ApiError propagate unchanged.
 */

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import type { IngestionSourceConfig } from "@/types/ingestion-source";
import { NextRequest } from "next/server";

const COLLECTION_NAME = "rag_ingestion_sources";

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ sourceId: string }> }) => {
    const { sourceId } = await context.params;
    const { session } = await getAuthFromBearerOrSession(request);

    const collection = await getCollection<IngestionSourceConfig>(COLLECTION_NAME);
    const source = await collection.findOne({ source_id: sourceId } as never);
    if (!source) {
      throw new ApiError("Source not found", 404, "SOURCE_NOT_FOUND");
    }

    await requireResourcePermission(
      session,
      { type: "ingestion_source", id: sourceId, action: "read" },
      { bypassForOrgAdmin: true },
    );

    return successResponse(source);
  },
);
