// assisted-by claude code claude-opus-4-8
//
// GET /api/projects/facets — distinct label values + counts (Domain,
// BHAG/Initiative, Swim Lane) over the caller's visible projects. Drives the
// executive dashboard and the hub's filter chips. RBAC mirrors /api/projects.

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { computeFacets } from "@/lib/projects/labels";
import { canManageProjectsOrganization } from "@/lib/projects/project-admin";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { ProjectDocument } from "@/types/projects";

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
  const projects = await getCollection<ProjectDocument>("projects");
  const isAdmin = await canManageProjectsOrganization(session);

  let filter: Record<string, unknown> = {};
  if (!isAdmin) {
    const email = user.email?.trim().toLowerCase();
    if (!email) {
      return successResponse({ facets: { domains: [], initiatives: [], swimlanes: [], total: 0 } });
    }
    const teams = await getCollection("teams");
    const memberships = await teams
      .find({ $or: [{ "members.user_id": email }, { owner_id: email }] })
      .project({ _id: 1 })
      .toArray();
    filter = { team_id: { $in: memberships.map((t) => String(t._id)) } };
  }

  const all = (await projects.find(filter).toArray()) as ProjectDocument[];
  return successResponse({ facets: computeFacets(all) });
});
