// assisted-by claude code claude-sonnet-4-6
import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { computeFacets } from "@/lib/projects/labels";
import { isTomeAdmin, type TomeAdminSession } from "@/lib/rbac/tome-admin";
import { listReadableTomeProjects } from "@/lib/tome/access";
import { tomeSessionSubject } from "@/lib/tome/data-steward";
import type { ProjectDocument } from "@/types/projects";

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return successResponse({ facets: { domains: [], initiatives: [], areas: [], tags: [] } });
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
  const adminSession = (session ?? {}) as TomeAdminSession;
  const isAdmin = await isTomeAdmin({
    ...adminSession,
    user: { ...adminSession.user, email: user.email ?? adminSession.user?.email },
  });
  const readable = await listReadableTomeProjects(tomeSessionSubject(session), {
    isAdmin,
  });
  const projects = readable.filter(
    (project) => project.type === "project" || project.type === undefined,
  ) as ProjectDocument[];
  const facets = computeFacets(projects);

  return successResponse({ facets });
});
