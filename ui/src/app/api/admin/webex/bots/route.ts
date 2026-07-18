import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { callWebexBotAdmin } from "@/lib/webex-bot-admin";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");
  const catalog = await callWebexBotAdmin<{ bots: unknown[] }>("/admin/webex/bots");
  return successResponse(catalog);
});
