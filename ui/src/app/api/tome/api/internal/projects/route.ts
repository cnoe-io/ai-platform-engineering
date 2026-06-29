// Internal agent callback: GET the full list of projects.
// Path matches agent/http_client.py fetch_all_projects:
//   {TTT_BACKEND_URL}/api/internal/projects   (TTT_BACKEND_URL = http://<host>/api/tome)
//
// The agent's persistent-workspace loader/sync uses this to enumerate which
// project dirs to materialize on disk (`<base>/<project_id>/`). `project_id` is
// the Mongo `_id` string — the SAME id `buildSnapshotFromProject` puts in the
// snapshot, so on-disk dirs match the per-request `project_root(snapshot.project_id)`.

import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { requireAgentToken } from "@/lib/tome/internal-api";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { ProjectDocument } from "@/types/projects";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (request: NextRequest) => {
  requireAgentToken(request);
  if (!isTomeServerEnabled()) {
    throw new ApiError("Not found", 404, "NOT_FOUND");
  }
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }

  const projects = await getCollection<ProjectDocument>("projects");
  const docs = await projects
    .find({})
    .project({ _id: 1, slug: 1, title: 1, name: 1 })
    .toArray();

  return Response.json({
    projects: docs.map((p) => ({
      project_id: String(p._id),
      slug: p.slug,
      name: p.title || p.name,
    })),
  });
});
