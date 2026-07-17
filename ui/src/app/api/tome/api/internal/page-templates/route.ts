// Internal agent callback: GET the live page-template config.
// Path matches agent/http_client.py fetch_page_templates:
//   {TTT_BACKEND_URL}/api/internal/page-templates
//
// The ingest agent fetches this at run start to assemble the page enumeration
// (top-level + per-source prompts, page seeding). Falls back to its hardcoded
// Python constants if this call fails, so ingest never hard-depends on it.

import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { requireAgentToken } from "@/lib/tome/internal-api";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { getAllPageTemplates } from "@/lib/tome/page-templates-store";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (request: NextRequest) => {
  requireAgentToken(request);
  if (!isTomeServerEnabled()) {
    throw new ApiError("Not found", 404, "NOT_FOUND");
  }
  const templates = await getAllPageTemplates();
  return Response.json({ templates });
});
