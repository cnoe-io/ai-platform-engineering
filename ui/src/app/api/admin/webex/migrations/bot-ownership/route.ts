import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  deleteLegacyWebexBotOwnership,
  migrateLegacyWebexBotOwnership,
  probeLegacyWebexBotOwnership,
  type LegacyWebexBotMigrationAssignment,
  type LegacyWebexBotMigrationTarget,
} from "@/lib/rbac/webex-bot-migration";

async function requireMigrationAdmin(request: NextRequest): Promise<void> {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  await requireMigrationAdmin(request);
  return successResponse({ candidates: await probeLegacyWebexBotOwnership() });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  await requireMigrationAdmin(request);
  const body = (await request.json().catch(() => ({}))) as { assignments?: unknown };
  if (!Array.isArray(body.assignments)) {
    throw new ApiError("assignments must be an array", 400);
  }
  const assignments = body.assignments.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApiError(`assignments[${index}] must be an object`, 400);
    }
    return value as LegacyWebexBotMigrationAssignment;
  });
  return successResponse({ result: await migrateLegacyWebexBotOwnership(assignments) });
});

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  await requireMigrationAdmin(request);
  const body = (await request.json().catch(() => ({}))) as { targets?: unknown };
  if (!Array.isArray(body.targets)) {
    throw new ApiError("targets must be an array", 400);
  }
  const targets = body.targets.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApiError(`targets[${index}] must be an object`, 400);
    }
    return value as LegacyWebexBotMigrationTarget;
  });
  return successResponse({ result: await deleteLegacyWebexBotOwnership(targets) });
});
