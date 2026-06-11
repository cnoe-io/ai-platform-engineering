// assisted-by Cursor Composer

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { projectCatalogBundleYaml } from "@/lib/projects/backstage-catalog";
import { runOnboardingDeletes, runOnboardingUpdates } from "@/lib/projects/onboarding-providers";
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
// Cascades to external resources for onboarding steps configured with a
// `deleteEndpoint` (best-effort) before removing the CAIPE record.
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

    // Cascade external deletions first (best-effort; never blocks the local
    // delete). Uses the OIDC sub so the external system authorizes the actor.
    const sub = (session as { sub?: string } | undefined)?.sub;
    const externalDeletes = await runOnboardingDeletes(project, sub);

    await projects.deleteOne({ _id: project._id });
    return successResponse({ deleted: true, slug, external: externalDeletes });
  },
);

// PATCH a project's editable fields (title, description, sources).
// Allowed for the project owner or a projects-org admin.
// Syncs changes to external resources via configured `updateEndpoint` steps.
export const PATCH = withErrorHandler(
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
        "You can only edit projects you own (or as a projects admin)",
        403,
        "FORBIDDEN",
      );
    }

    const body = (await request.json()) as {
      title?: string;
      description?: string;
      sources?: { repos?: string[]; confluence_url?: string };
    };

    const $set: Record<string, unknown> = { updated_at: new Date() };
    if (typeof body.title === "string" && body.title.trim()) {
      $set["title"] = body.title.trim();
    }
    if (typeof body.description === "string") {
      $set["description"] = body.description.trim();
    }
    if (body.sources) {
      if (Array.isArray(body.sources.repos)) {
        $set["sources.repos"] = body.sources.repos.map((r) => r.trim()).filter(Boolean);
      }
      if (typeof body.sources.confluence_url === "string") {
        $set["sources.confluence_url"] = body.sources.confluence_url.trim();
      }
    }

    await projects.updateOne({ _id: project._id }, { $set });

    const updated = await projects.findOne({ slug });
    if (!updated) throw new ApiError("Project not found after update", 500, "UPDATE_FAILED");

    const sub = (session as { sub?: string } | undefined)?.sub;
    const externalUpdates = await runOnboardingUpdates(updated, sub);

    return successResponse({
      project: { ...updated, _id: String(updated._id) },
      external: externalUpdates,
    });
  },
);
