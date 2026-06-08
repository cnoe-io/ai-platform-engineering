// assisted-by Cursor Composer

import { createHash } from "crypto";

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  getOnboardingStepOrder,
  isOnboardingComplete,
  runOnboardingStep,
} from "@/lib/projects/onboarding-providers";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { OnboardProjectRequest, ProjectDocument } from "@/types/projects";

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
  // Match the agentic-app proxy's identity key (session.sub, else sha256(email))
  // so projects onboarded here are owned by the same subject the proxy sends as
  // `x-caipe-user` when the user opens /apps/ttt — otherwise TTT won't list them.
  const sub = (session as { sub?: string } | undefined)?.sub?.trim();
  const actorSubject =
    sub && sub.length > 0
      ? sub
      : createHash("sha256").update(user.email ?? "").digest("hex");
  const body = (await request.json()) as OnboardProjectRequest;

  if (!body.project_id?.trim()) {
    throw new ApiError("project_id is required", 400, "VALIDATION_ERROR");
  }

  const projects = await getCollection<ProjectDocument>("projects");
  let project: ProjectDocument | null = null;

  if (ObjectId.isValid(body.project_id)) {
    project = await projects.findOne({ _id: new ObjectId(body.project_id) });
  }
  if (!project) {
    project = await projects.findOne({ slug: body.project_id });
  }
  if (!project) {
    throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const stepOrder = getOnboardingStepOrder();
  const stepsToRun: string[] =
    body.steps && body.steps.length > 0 ? body.steps : stepOrder;

  const results: Array<{
    step: string;
    status: "completed" | "failed";
    error?: string;
    mock_ref?: string;
    status_message?: string;
  }> = [];

  let current = { ...project };
  await projects.updateOne(
    { _id: project._id },
    { $set: { status: "onboarding", updated_at: new Date() } },
  );

  for (const stepId of stepsToRun) {
    const onboarding = { ...(current.onboarding ?? {}) };
    onboarding[stepId] = { status: "running" };
    await projects.updateOne(
      { _id: project._id },
      { $set: { onboarding, updated_at: new Date() } },
    );

    try {
      const outcome = await runOnboardingStep(stepId, current, actorSubject);
      const integrations = { ...current.integrations, ...outcome.integrations };
      onboarding[stepId] = {
        status: "completed",
        completed_at: new Date(),
        mock_ref: outcome.mock_ref,
      };
      current = { ...current, onboarding, integrations };
      await projects.updateOne(
        { _id: project._id },
        {
          $set: {
            onboarding,
            integrations,
            updated_at: new Date(),
          },
        },
      );
      results.push({
        step: stepId,
        status: "completed",
        mock_ref: outcome.mock_ref,
        status_message: outcome.status_message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onboarding[stepId] = { status: "failed", error: message };
      await projects.updateOne(
        { _id: project._id },
        { $set: { onboarding, updated_at: new Date() } },
      );
      results.push({ step: stepId, status: "failed", error: message });
      break;
    }
  }

  const allComplete = isOnboardingComplete(current.onboarding);
  if (allComplete) {
    await projects.updateOne(
      { _id: project._id },
      { $set: { status: "active", updated_at: new Date() } },
    );
    current.status = "active";
  }

  const refreshed = await projects.findOne({ _id: project._id });

  return successResponse({
    results,
    project: refreshed
      ? { ...refreshed, _id: String(refreshed._id) }
      : { ...current, _id: String(project._id) },
  });
});
