import { NextRequest } from "next/server";

import { successResponse,withErrorHandler } from "@/lib/api-middleware";
import { callSlackBotAdmin } from "@/lib/slack-bot-admin";

import { withSlackChannelRebacManageAuth } from "../../channels/_lib";

export const POST = withErrorHandler(async (request: NextRequest) =>
  withSlackChannelRebacManageAuth(request, async () => {
    const body = await request.json().catch(() => ({}));
    const result = await callSlackBotAdmin("/admin/slack/routes/reload", {
      method: "POST",
      body,
    });
    return successResponse(result);
  })
);
