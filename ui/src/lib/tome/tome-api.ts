/**
 * Shared server helpers for Tome API routes.
 *
 * Tome routes are nested under a CAIPE project slug and reuse CAIPE's auth +
 * project entity (no parallel project store). This module centralizes the
 * feature gate + project resolution + membership check so each route stays
 * linear.
 *
 * Server-only.
 */

import type { NextRequest } from "next/server";
import {
  ApiError,
  getAuthFromBearerOrSession,
} from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { canManageProjectsOrganization } from "@/lib/projects/project-admin";
import { isBootstrapAdmin } from "@/lib/auth-config";
import { isTomeServerEnabled } from "./guard";
import type { ProjectDocument } from "@/types/projects";

export interface TomeProjectContext {
  project: ProjectDocument & { _id: string };
  /** Stable project id used as the FK across Tome collections. */
  projectId: string;
  user: { email?: string };
  session: unknown;
  /** Whether the caller may edit pages (owner, member, or org admin). */
  canEdit: boolean;
}

/**
 * Gate + authenticate + resolve the CAIPE project for a Tome route.
 *
 * Order matters: 404 first when the feature is off (don't leak existence),
 * then 503 if Mongo isn't configured, then auth (401 via middleware), then
 * 404 if the project doesn't exist.
 */
export async function loadTomeProject(
  request: NextRequest,
  slug: string,
): Promise<TomeProjectContext> {
  if (!isTomeServerEnabled()) {
    throw new ApiError("Not found", 404, "NOT_FOUND");
  }
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }

  const { user, session } = await getAuthFromBearerOrSession(request);

  const projects = await getCollection<ProjectDocument>("projects");
  const project = await projects.findOne({ slug });
  if (!project) {
    throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const isOwner = Boolean(user.email) && project.owner_id === user.email;
  const isMember =
    Boolean(user.email) && project.member_ids?.includes(user.email ?? "");
  // Bootstrap admins (BOOTSTRAP_ADMIN_EMAILS) are honored even for API-key /
  // bearer callers, so the Tome MCP mirrors what an admin sees in the web UI —
  // the OpenFGA org-manage check only succeeds for cookie sessions carrying a
  // Keycloak access token.
  const isOrgAdmin =
    (await canManageProjectsOrganization(session)) || isBootstrapAdmin(user.email);
  const canEdit = isOwner || Boolean(isMember) || isOrgAdmin;

  const resolved = { ...project, _id: String(project._id) };
  return {
    project: resolved,
    projectId: resolved._id,
    user,
    session,
    canEdit,
  };
}

/**
 * Ensure the project carries the Tome integration tile so it surfaces on the
 * project's Apps grid (ProjectDetailView renders tiles from `<slug>_url`
 * integration entries; a relative URL → an internal in-app link). Idempotent —
 * only writes when the tile is absent.
 */
export async function ensureTomeTile(slug: string): Promise<void> {
  const projects = await getCollection<ProjectDocument>("projects");
  const project = await projects.findOne({ slug });
  if (!project) return;
  if (project.integrations?.tome_url) return;
  await projects.updateOne(
    { _id: project._id },
    {
      $set: {
        "integrations.tome_url": `/projects/${slug}/tome`,
        "integrations.tome_label": "TOME",
        updated_at: new Date(),
      },
    },
  );
}

/** Throw 403 unless the caller may edit pages. */
export function requireTomeEditor(ctx: TomeProjectContext): void {
  if (!ctx.canEdit) {
    throw new ApiError(
      "You do not have edit access to this project's wiki",
      403,
      "FORBIDDEN",
    );
  }
}
