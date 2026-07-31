// GET /api/tome/projects/[slug]/engagement — this project's own chat
// engagement + ingestion/consumption snapshot, project-scoped only (never
// rolled up cross-project, unlike the org-wide admin consumption view).
//
// Read-only + any project reader (same gating as chat/feed-status) — no
// per-user detail is exposed, just aggregate counts.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getProjectConsumption, getProjectEngagement } from "@/lib/tome/analytics";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);

  const [engagement, consumption] = await Promise.all([
    getProjectEngagement(projectId),
    getProjectConsumption(projectId),
  ]);

  return successResponse({ engagement, consumption });
});
