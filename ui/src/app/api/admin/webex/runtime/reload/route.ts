import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { callWebexBotAdmin } from "@/lib/webex-bot-admin";

import { withWebexSpaceRebacManageAuth } from "../../spaces/_lib";

function parseReloadBody(value: unknown): { dry_run?: boolean } {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("Request body must be an object", 400);
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(["dry_run"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new ApiError(`Unexpected field "${key}"`, 400);
    }
  }
  if (input.dry_run === undefined) {
    return {};
  }
  const dryRun = input.dry_run;
  if (typeof dryRun !== "boolean") {
    throw new ApiError("dry_run must be a boolean", 400);
  }
  return { dry_run: dryRun };
}

export const POST = withErrorHandler(async (request: NextRequest) =>
  withWebexSpaceRebacManageAuth(request, async () => {
    const body = parseReloadBody(await request.json().catch(() => ({})));
    const result = await callWebexBotAdmin("/admin/webex/routes/reload", {
      method: "POST",
      body,
    });
    return successResponse(result);
  })
);
