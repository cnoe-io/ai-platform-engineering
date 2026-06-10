// assisted-by Cursor Composer

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { projectCatalogBundleYaml } from "@/lib/projects/backstage-catalog";
import { canManageProjectsOrganization } from "@/lib/projects/project-admin";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { ProjectDocument } from "@/types/projects";

export const GET = withErrorHandler(
  async (_request: NextRequest, context: { params: Promise<{ slug: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
    }

    await getAuthFromBearerOrSession(_request);
    const { slug } = await context.params;

    const projects = await getCollection<ProjectDocument>("projects");
    const project = await projects.findOne({ slug });
    if (!project) {
      throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
    }

    return successResponse({
      project: {
        ...project,
        _id: String(project._id),
      },
      catalog_yaml: projectCatalogBundleYaml(project),
    });
  },
);

// DELETE a project. Allowed for the project owner or a projects-org admin.
// Removes the CAIPE record only — external resources (e.g. an LLM Wiki space)
// are not deleted here.
export const DELETE = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ slug: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
    }

    const { user, session } = await getAuthFromBearerOrSession(request);
    const { slug } = await context.params;

    const projects = await getCollection<ProjectDocument>("projects");
    const project = await projects.findOne({ slug });
    if (!project) {
      throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
    }

    const isOwner = Boolean(user.email) && project.owner_id === user.email;
    const isOrgAdmin = await canManageProjectsOrganization(session);
    if (!isOwner && !isOrgAdmin) {
      throw new ApiError(
        "You can only delete projects you own (or as a projects admin)",
        403,
        "FORBIDDEN",
      );
    }

    await projects.deleteOne({ _id: project._id });
    return successResponse({ deleted: true, slug });
  },
);
