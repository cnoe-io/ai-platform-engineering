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
import { isTomeServerEnabled } from "./guard";
import { getTomeProjectPermissions } from "./data-steward";
import type { ProjectDocument } from "@/types/projects";

export interface TomeProjectContext {
  project: ProjectDocument & { _id: string };
  /** Stable project id used as the FK across Tome collections. */
  projectId: string;
  user: { email?: string };
  session: unknown;
  /** Whether OpenFGA authorizes the caller to discover and read this entity. */
  canRead: boolean;
  /** Whether OpenFGA authorizes the caller as data steward or Tome admin. */
  canEdit: boolean;
  /** Tome admins may change the steward assignment itself. */
  canManageSteward: boolean;
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

  const permissions = await getTomeProjectPermissions({ project, user, session });
  if (!permissions.canRead) {
    throw new ApiError(
      "This Tome entity is not shared with one of your teams",
      403,
      "TOME_READ_REQUIRED",
    );
  }

  const resolved = { ...project, _id: String(project._id) };
  return {
    project: resolved,
    projectId: resolved._id,
    user,
    session,
    canRead: permissions.canRead,
    canEdit: permissions.canEdit,
    canManageSteward: permissions.canManageSteward,
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

/** Throw 403 unless OpenFGA authorizes the caller as steward or Tome admin. */
export function requireTomeEditor(ctx: TomeProjectContext): void {
  if (!ctx.canEdit) {
    throw new ApiError(
      "Only this entity's data steward or a Tome admin can modify its data",
      403,
      "DATA_STEWARD_REQUIRED",
    );
  }
}

/**
 * Reject a human write while the project is locked, with a message that
 * distinguishes "agent is actively ingesting" from "a draft is awaiting
 * review" — the latter still can't be hand-edited (it would race approve
 * or leave the diff meaningless), but for a different reason.
 */
export async function guardNotLocked(projectId: string, locked: boolean): Promise<void> {
  if (!locked) return;
  const { getTomeIngestRunsCollection } = await import("./mongo-collections");
  const runs = await getTomeIngestRunsCollection();
  const active = await runs.findOne({
    project_id: projectId,
    status: { $in: ["running", "awaiting_review"] },
  });
  if (active?.status === "awaiting_review") {
    throw new ApiError(
      "A draft ingest is awaiting review — approve or reject it before editing pages.",
      409,
      "PROJECT_AWAITING_REVIEW",
    );
  }
  throw new ApiError(
    "An ingest is in progress — the wiki is read-only until it finishes.",
    409,
    "PROJECT_LOCKED",
  );
}
