/** Per-user saved GitHub issue filters, scoped to one readable TOME project. */

import { NextRequest } from "next/server";

import {
  ApiError,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { normalizeStoredIssueFilterViews } from "@/lib/tome/issue-filter-views";
import { loadTomeProject } from "@/lib/tome/tome-api";
import {
  readTomeIssueFilterViews,
  writeTomeIssueFilterViews,
} from "@/lib/tome/user-preferences-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function preferenceScope(session: unknown): { tenantId: string; userId: string } {
  const candidate = session && typeof session === "object"
    ? session as { sub?: unknown; org?: unknown }
    : {};
  const userId = typeof candidate.sub === "string" ? candidate.sub.trim() : "";
  if (!userId) throw new ApiError("Sign in required", 401, "NOT_SIGNED_IN");
  const tenantId = typeof candidate.org === "string" && candidate.org.trim()
    ? candidate.org.trim()
    : "default";
  return { tenantId, userId };
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const project = await loadTomeProject(request, slug);
  const { tenantId, userId } = preferenceScope(project.session);
  const preferences = await readTomeIssueFilterViews(
    tenantId,
    userId,
    project.projectId,
  );
  return successResponse(preferences);
});

export const PUT = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const project = await loadTomeProject(request, slug);
  const { tenantId, userId } = preferenceScope(project.session);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw new ApiError("Saved issue filters are required", 400, "BAD_REQUEST");
  }
  const normalized = normalizeStoredIssueFilterViews(body);
  const preferences = await writeTomeIssueFilterViews(
    tenantId,
    userId,
    project.projectId,
    normalized,
  );
  return successResponse(preferences);
});
