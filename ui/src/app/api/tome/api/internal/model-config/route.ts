// Internal agent callback: GET the live per-role model config.
// Path matches agent/http_client.py fetch_model_config:
//   {TTT_BACKEND_URL}/api/internal/model-config
//
// Each agent surface (ingest/chat/synthesize/compact) fetches this at run
// start to resolve which model to run. Falls back to its hardcoded Python
// constant if this call fails, so no surface hard-depends on it.

import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { requireAgentToken } from "@/lib/tome/internal-api";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { resolveAllModelConfigs } from "@/lib/tome/model-config-store";
import type { ProjectType } from "@/types/projects";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (request: NextRequest) => {
  requireAgentToken(request);
  if (!isTomeServerEnabled()) {
    throw new ApiError("Not found", 404, "NOT_FOUND");
  }
  const entityId = request.nextUrl.searchParams.get("entity_id")?.trim();
  const rawType = request.nextUrl.searchParams.get("entity_type")?.trim() ?? "project";
  if (!entityId) throw new ApiError("entity_id is required", 400, "INVALID_REQUEST");
  if (!["project", "area", "bhag"].includes(rawType)) {
    throw new ApiError("entity_type must be project, area, or bhag", 400, "INVALID_REQUEST");
  }
  const models = await resolveAllModelConfigs({
    entityId,
    entityType: rawType as ProjectType,
  });
  return Response.json({ models });
});
