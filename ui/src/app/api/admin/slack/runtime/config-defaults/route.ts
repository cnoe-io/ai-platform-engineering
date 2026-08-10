import { NextRequest } from "next/server";

import { successResponse,withErrorHandler } from "@/lib/api-middleware";
import { callSlackBotAdmin } from "@/lib/slack-bot-admin";

import { withSlackChannelRebacViewAuth } from "../../channels/_lib";

export const GET = withErrorHandler(async (request: NextRequest) =>
  withSlackChannelRebacViewAuth(request, async () => {
    const defaults = await callSlackBotAdmin("/admin/slack/routes/config-defaults");
    return successResponse(defaults);
  })
);
