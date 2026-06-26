export type NewConversationAgentSelection = string | null | undefined;

export async function resolvePlatformDefaultAgentId(): Promise<string | undefined> {
  try {
    const response = await fetch("/api/admin/platform-config");
    const data = await response.json().catch(() => ({ success: false }));
    const agentId = data?.success ? data.data?.default_agent_id : null;
    return typeof agentId === "string" && agentId.trim() ? agentId.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveNewConversationAgentId(
  agentId?: NewConversationAgentSelection,
): Promise<string | undefined> {
  if (agentId === null) {
    return undefined;
  }

  const explicitAgentId = agentId?.trim();
  if (explicitAgentId) {
    return explicitAgentId;
  }

  if (agentId === undefined) {
    return resolvePlatformDefaultAgentId();
  }

  return undefined;
}
