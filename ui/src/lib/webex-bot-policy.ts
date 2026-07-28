import { ApiError } from "@/lib/api-error";
import { callWebexBotAdmin } from "@/lib/webex-bot-admin";

export type WebexSpaceAccessMode = "disabled" | "allowlist" | "all_spaces";
export type WebexDmAccessMode = "disabled" | "allowlist" | "all_users";

export interface WebexBotPolicy {
  id: string;
  name: string;
  available: boolean;
  spaces: {
    accessMode: WebexSpaceAccessMode;
    defaultTeamSlug: string | null;
    defaultAgentId: string | null;
  };
  directMessages: {
    accessMode: WebexDmAccessMode;
    defaultAgentId: string | null;
  };
}

export async function listWebexBotPolicies(): Promise<WebexBotPolicy[]> {
  const catalog = await callWebexBotAdmin<{ bots?: WebexBotPolicy[] }>(
    "/admin/webex/bots",
  );
  return catalog.bots ?? [];
}

export async function requireAvailableWebexBotPolicy(
  botId: string | null | undefined,
): Promise<WebexBotPolicy> {
  const requestedId = botId?.trim();
  const bot = (await listWebexBotPolicies()).find(
    (candidate) => candidate.id === requestedId,
  );
  if (!bot) throw new ApiError(`Unknown Webex bot: ${requestedId ?? ""}`, 400);
  if (!bot.available) {
    throw new ApiError(`Webex bot "${bot.name}" is not configured`, 503);
  }
  return bot;
}
