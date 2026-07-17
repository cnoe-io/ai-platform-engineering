import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  getSlackIntegrationToken,
  isSlackIntegrationEnabled,
} from "@/lib/integration-config";
import { callSlackBotAdmin } from "@/lib/slack-bot-admin";
import {
  getSlackEmojiDirectoryStatus,
  warmSlackEmojiDirectory,
} from "../../emoji/route";
import {
  getSlackUsersDirectoryStatus,
  warmSlackUsersDirectory,
} from "../../users/lookup/route";

function emptyUsersDirectoryStatus(error?: string) {
  return {
    status: "empty" as const,
    users_indexed: 0,
    active_users_indexed: 0,
    pages_scanned: 0,
    members_seen: 0,
    fetched_at: null,
    updated_at: null,
    started_at: null,
    last_error: error,
  };
}

function emptyEmojiDirectoryStatus(error?: string) {
  return {
    status: "empty" as const,
    emoji_indexed: 0,
    fetched_at: null,
    updated_at: null,
    started_at: null,
    last_error: error,
  };
}

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

  const enabled = isSlackIntegrationEnabled();
  const token = getSlackIntegrationToken();
  if (!enabled) {
    return successResponse({
      configured: false,
      bot_admin: { reachable: false, error: "Slack integration is not enabled." },
      users: emptyUsersDirectoryStatus(),
      emoji: emptyEmojiDirectoryStatus(),
    });
  }

  if (!token) {
    const error = "SLACK_BOT_TOKEN or SLACK_INTEGRATION_BOT_TOKEN is not configured on the UI service.";
    return successResponse({
      configured: true,
      bot_admin: await slackBotAdminStatus(),
      users: emptyUsersDirectoryStatus(error),
      emoji: emptyEmojiDirectoryStatus(error),
    });
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
