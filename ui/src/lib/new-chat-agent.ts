import { getConfig } from "@/lib/config";

export type NewConversationAgentSelection = string | null | undefined;

export function getDefaultNewChatAgentId(): string | undefined {
  if (!getConfig("dynamicAgentsEnabled")) {
    return undefined;
  }

  return getConfig("defaultNewChatAgentId")?.trim() || undefined;
}

export function resolveNewConversationAgentId(agentId?: NewConversationAgentSelection): string | undefined {
  if (agentId === null) {
    return undefined;
  }

  const explicitAgentId = agentId?.trim();
  if (explicitAgentId) {
    return explicitAgentId;
  }

  if (agentId === undefined) {
    return getDefaultNewChatAgentId();
  }

  return undefined;
}
