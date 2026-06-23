// assisted-by claude code claude-sonnet-4-6
import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isBootstrapAdmin } from "@/lib/auth-config";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { computeFacets } from "@/lib/projects/labels";
import { canManageProjectsOrganization } from "@/lib/projects/project-admin";
import type { ProjectDocument } from "@/types/projects";

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return successResponse({ facets: { domains: [], initiatives: [], swimlanes: [], tags: [] } });
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
  const isOrgAdmin =
    (await canManageProjectsOrganization(session)) || isBootstrapAdmin(user.email);

  const col = await getCollection<ProjectDocument>("projects");
  const filter = isOrgAdmin
    ? {}
    : { $or: [{ owner_id: user.email }, { member_ids: user.email }] };

  const projects = await col.find(filter).toArray();
  const facets = computeFacets(projects);

  return successResponse({ facets });
});
