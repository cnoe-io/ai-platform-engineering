import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { parseWebexSpaceRouteParams } from "@/lib/rbac/webex-space-openfga";
import { checkWebexSpaceAccess } from "@/lib/rbac/webex-space-rebac";
import type { UniversalRebacResourceAction, UniversalRebacResourceRef } from "@/types/rbac-universal";

interface RouteContext {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

function parseResource(value: unknown): UniversalRebacResourceRef {
  if (!value || typeof value !== "object") {
    throw new ApiError("resource is required", 400);
  }
  const resource = value as Record<string, unknown>;
  const type = typeof resource.type === "string" ? resource.type.trim() : "";
  const id = typeof resource.id === "string" ? resource.id.trim() : "";
  if (!type || !id) {
    throw new ApiError("resource.type and resource.id are required", 400);
  }
  return { type: type as UniversalRebacResourceRef["type"], id };
}

export const POST = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const { session } = await getAuthFromBearerOrSession(request);
  void session; // Authentication is required; agent-level can_use is the authorization gate.

  const raw = await context.params;
  const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);

  const body = (await request.json()) as Record<string, unknown>;
  const action =
    typeof body.action === "string" && body.action.trim()
      ? (body.action.trim() as UniversalRebacResourceAction)
      : null;
  if (!action) {
    throw new ApiError("action is required", 400);
  }

  const result = await checkWebexSpaceAccess({
    workspace_id: workspaceId,
    space_id: spaceId,
    resource: parseResource(body.resource),
    action,
  });

  return successResponse(result);
});
