import { NextRequest } from "next/server";

import { successResponse,withErrorHandler } from "@/lib/api-middleware";
import { callWebexBotAdmin } from "@/lib/webex-bot-admin";

import { withWebexSpaceRebacViewAuth } from "../../spaces/_lib";

export const GET = withErrorHandler(async (request: NextRequest) =>
  withWebexSpaceRebacViewAuth(request, async () => {
    const status = await callWebexBotAdmin("/admin/webex/routes/status");
    return successResponse(status);
  })
);
