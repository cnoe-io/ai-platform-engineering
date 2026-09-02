import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { customTomeTrackerLabel, tomeTrackedIssueLabel } from "@/lib/tome/issue-filter-views";
import {
  addTomeCustomIssueTracker,
  readTomeCustomIssueTrackers,
} from "@/lib/tome/issue-tracker-store";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const project = await loadTomeProject(request, slug);
  const labels = await readTomeCustomIssueTrackers(project.projectId);
  return successResponse({ trackers: labels.map(tomeTrackedIssueLabel) });
});

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const project = await loadTomeProject(request, slug);
  requireTomeEditor(project);
  const body = await request.json().catch(() => null) as { suffix?: unknown } | null;
  const label = typeof body?.suffix === "string"
    ? customTomeTrackerLabel(body.suffix)
    : null;
  if (!label) {
    throw new ApiError(
      "Use lowercase letters, numbers, and hyphens after tome:",
      400,
      "INVALID_TOME_TRACKER_LABEL",
    );
  }
  const labels = await addTomeCustomIssueTracker(project.projectId, label);
  return successResponse({ trackers: labels.map(tomeTrackedIssueLabel) });
});
