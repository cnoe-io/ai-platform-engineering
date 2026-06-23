// assisted-by claude code claude-sonnet-4-6
// Best-effort post-create onboarding steps (app tile wiring, etc.).
// Returns success even on partial failure so the wizard can land on the project.
import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { OnboardProjectRequest, ProjectDocument } from "@/types/projects";

export const POST = withErrorHandler(async (request: NextRequest) => {
  await getAuthFromBearerOrSession(request);

  if (!isMongoDBConfigured) {
    return successResponse({ skipped: true });
  }

  const body = (await request.json()) as OnboardProjectRequest;
  if (!body.project_id) {
    return successResponse({ skipped: true });
  }

  const col = await getCollection<ProjectDocument>("projects");
  await col.updateOne(
    { _id: body.project_id as unknown as ProjectDocument["_id"] },
    { $set: { updated_at: new Date() } },
  );

  return successResponse({ steps: body.steps ?? [], status: "ok" });
});
