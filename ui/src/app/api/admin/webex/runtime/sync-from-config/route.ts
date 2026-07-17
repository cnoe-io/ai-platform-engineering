import { NextRequest } from "next/server";

import {
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { callWebexBotAdmin } from "@/lib/webex-bot-admin";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await callWebexBotAdmin("/admin/webex/routes/sync-from-config", {
    method: "POST",
    body: {
      bot_id: body.bot_id,
      dry_run: body.dry_run !== false,
      actor: {
        email: user.email,
        name: user.name,
        sub: typeof session.sub === "string" ? session.sub : undefined,
      },
    },
  });
  return successResponse(result);
});
