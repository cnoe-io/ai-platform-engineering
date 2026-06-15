import { NextRequest } from "next/server";

import {
ApiError,
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { callSlackBotAdmin } from "@/lib/slack-bot-admin";
import { getSlackEmojiDirectoryStatus,warmSlackEmojiDirectory } from "../../emoji/route";
import { getSlackUsersDirectoryStatus,warmSlackUsersDirectory } from "../../users/lookup/route";

async function slackBotAdminStatus(): Promise<{ reachable: boolean; error?: string }> {
  try {
    await callSlackBotAdmin("/admin/slack/routes/status");
    return { reachable: true };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) {
    throw new ApiError("SLACK_BOT_TOKEN is not configured on the UI service.", 503);
  }

  warmSlackUsersDirectory(token);
  warmSlackEmojiDirectory(token);

  const bot_admin = await slackBotAdminStatus();
  return successResponse({
    configured: true,
    bot_admin,
    users: getSlackUsersDirectoryStatus(token),
    emoji: getSlackEmojiDirectoryStatus(token),
  });
});
