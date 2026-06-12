/**
 * Internal agent-callback surface (agent → CAIPE).
 *
 * The reused TTT agent calls back to `{TTT_BACKEND_URL}/api/internal/...` to
 * fetch the project snapshot / stable pages and to persist pages + ingest log
 * lines (see agent/http_client.py). These are NOT user-facing routes: they're
 * authenticated by a shared bearer token (`TOME_AGENT_TOKEN`) since the caller
 * is the agent service, not an interactive user.
 *
 * Server-only.
 */

import type { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import { ApiError } from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { isTomeServerEnabled } from "./guard";
import type { ProjectDocument } from "@/types/projects";

/**
 * Validate the agent's shared-token bearer. When `TOME_AGENT_TOKEN` is unset
 * (local dev), auth is skipped — the agent and CAIPE talk over localhost.
 */
export function requireAgentToken(request: NextRequest): void {
  const expected = process.env.TOME_AGENT_TOKEN;
  if (!expected) return; // dev: no token configured → allow
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token !== expected) {
    throw new ApiError("Invalid agent token", 401, "AGENT_UNAUTHORIZED");
  }
}

/** Resolve a project by slug or ObjectId hex (the agent passes either). */
export async function resolveProject(
  idOrSlug: string,
): Promise<ProjectDocument & { _id: string }> {
  if (!isTomeServerEnabled()) {
    throw new ApiError("Not found", 404, "NOT_FOUND");
  }
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }
  const projects = await getCollection<ProjectDocument>("projects");
  let project = await projects.findOne({ slug: idOrSlug });
  if (!project && ObjectId.isValid(idOrSlug)) {
    project = await projects.findOne({ _id: new ObjectId(idOrSlug) as unknown as string });
  }
  if (!project) {
    throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
  }
  return { ...project, _id: String(project._id) };
}
