import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { onboardWebexSpace } from "@/lib/rbac/webex-space-onboarding";
import type { WebexRouteListenMode } from "@/types/webex-rebac";

import { withWebexSpaceRebacManageAuth } from "../_lib";

const ALLOWED_FIELDS = new Set([
  "workspace_id",
  "space_id",
  "space_name",
  "team_slug",
  "agent_id",
  "listen",
  "dry_run",
  "reload_runtime",
]);

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRequiredString(value: unknown, field: string): string {
  const trimmed = readOptionalString(value);
  if (!trimmed) {
    throw new ApiError(`${field} is required`, 400);
  }
  return trimmed;
}

function parseOnboardBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("Request body must be an object", 400);
  }
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new ApiError(`Unexpected field "${key}"`, 400);
    }
  }
  return {
    workspace_id: readOptionalString(input.workspace_id),
    space_id: readRequiredString(input.space_id, "space_id"),
    space_name: readOptionalString(input.space_name),
    team_slug: readRequiredString(input.team_slug, "team_slug"),
    agent_id: readRequiredString(input.agent_id, "agent_id"),
    listen: readOptionalString(input.listen) as WebexRouteListenMode | undefined,
    dry_run: Boolean(input.dry_run),
    reload_runtime: input.reload_runtime === undefined ? undefined : Boolean(input.reload_runtime),
    actor: "api",
  };
}

export const POST = withErrorHandler(async (request: NextRequest) =>
  withWebexSpaceRebacManageAuth(request, async () => {
    const result = await onboardWebexSpace(parseOnboardBody(await request.json()));
    return successResponse(result);
  })
);
