import type { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { testTomeModel } from "@/lib/tome/model-check";
import {
  AGENT_ROLES,
  deleteModelConfig,
  getScopeModelConfigs,
  ModelConfigValidationFailure,
  resolveAllModelConfigs,
  updateModelConfig,
  type AgentRole,
} from "@/lib/tome/model-config-store";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";

type Context = { params: Promise<{ slug: string }> };

function parseRole(value: unknown): AgentRole {
  if (typeof value !== "string" || !(AGENT_ROLES as readonly string[]).includes(value)) {
    throw new ApiError("Unknown model role", 400, "INVALID_MODEL_ROLE");
  }
  return value as AgentRole;
}

export const GET = withErrorHandler(async (request: NextRequest, context: Context) => {
  const { slug } = await context.params;
  const { project, projectId, canEdit } = await loadTomeProject(request, slug);
  const scope = { kind: "exact" as const, id: projectId };
  const [configs, resolved] = await Promise.all([
    getScopeModelConfigs(scope),
    resolveAllModelConfigs({ entityId: projectId, entityType: project.type ?? "project" }),
  ]);
  return Response.json({ configs, resolved, can_edit: canEdit, entity_type: project.type ?? "project" });
});

export const POST = withErrorHandler(async (request: NextRequest, context: Context) => {
  const { slug } = await context.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  const body = (await request.json()) as { model?: unknown };
  if (typeof body.model !== "string" || !body.model.trim()) {
    throw new ApiError("Model id is required", 400, "INVALID_MODEL");
  }
  return Response.json(await testTomeModel(body.model));
});

export const PATCH = withErrorHandler(async (request: NextRequest, context: Context) => {
  const { slug } = await context.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  const body = (await request.json()) as { role?: unknown; model?: unknown };
  const role = parseRole(body.role);
  if (typeof body.model !== "string" || !body.model.trim()) {
    throw new ApiError("Model id is required", 400, "INVALID_MODEL");
  }

  const tested = await testTomeModel(body.model);
  if (!tested.ok) {
    throw new ApiError(
      `Model test failed: ${"error" in tested ? tested.error : "unknown error"}`,
      422,
      "MODEL_TEST_FAILED",
    );
  }
  try {
    const config = await updateModelConfig(
      { kind: "exact", id: tctx.projectId },
      role,
      body.model,
      tctx.user.email ?? null,
      new Date().toISOString(),
    );
    return Response.json({ config });
  } catch (error) {
    if (error instanceof ModelConfigValidationFailure) {
      throw new ApiError(error.errors.map((item) => item.message).join(" "), 422, "INVALID_MODEL");
    }
    throw error;
  }
});

export const DELETE = withErrorHandler(async (request: NextRequest, context: Context) => {
  const { slug } = await context.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  const role = parseRole(request.nextUrl.searchParams.get("role"));
  await deleteModelConfig({ kind: "exact", id: tctx.projectId }, role);
  return Response.json({ config: null });
});
