// assisted-by Cursor Composer

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { projectCatalogBundleYaml } from "@/lib/projects/backstage-catalog";
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
