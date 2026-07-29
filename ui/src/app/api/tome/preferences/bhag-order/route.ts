// GET/PUT the signed-in user's BHAG order on the projects hub.

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { normalizeBhagOrder } from "@/lib/tome/bhag-order";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import {
  readTomeBhagOrder,
  writeTomeBhagOrder,
} from "@/lib/tome/user-preferences-store";

export const dynamic = "force-dynamic";

function preferenceScope(session: { sub?: unknown; org?: unknown }): {
  tenantId: string;
  userId: string;
} {
  const userId = typeof session.sub === "string" ? session.sub.trim() : "";
  if (!userId) throw new ApiError("Sign in required", 401, "NOT_SIGNED_IN");
  const tenantId =
    typeof session.org === "string" && session.org.trim() ? session.org.trim() : "default";
  return { tenantId, userId };
}

async function requireScope(request: NextRequest) {
  if (!isTomeServerEnabled()) throw new ApiError("Not found", 404, "NOT_FOUND");
  const { session } = await getAuthFromBearerOrSession(request);
  if (!(await isTomeAdmin(session))) {
    throw new ApiError("Tome admin access required", 403, "FORBIDDEN");
  }
  return preferenceScope(session);
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { tenantId, userId } = await requireScope(request);
  const bhagOrder = await readTomeBhagOrder(tenantId, userId);
  return successResponse({ bhag_order: bhagOrder });
});

export const PUT = withErrorHandler(async (request: NextRequest) => {
  const { tenantId, userId } = await requireScope(request);
  const body = (await request.json().catch(() => null)) as {
    bhag_order?: unknown;
  } | null;
  if (!body || !Array.isArray(body.bhag_order)) {
    throw new ApiError("`bhag_order` must be an array of BHAG labels", 400, "BAD_REQUEST");
  }
  const bhagOrder = normalizeBhagOrder(body.bhag_order);
  await writeTomeBhagOrder(tenantId, userId, bhagOrder);
  return successResponse({ bhag_order: bhagOrder });
});
