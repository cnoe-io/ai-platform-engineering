import type { ConnectorListenMode,ConnectorRuntimeRouteDiagnostic } from "@/lib/rbac/connector-diagnostics";

/** Turn `agent-jira-gu` into a readable label for admin UI copy. */
export function formatAgentLabel(agentId: string): string {
  const slug = agentId.replace(/^agent-/, "").trim();
  if (!slug) return agentId;
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatAgentList(agentIds: string[]): string {
  return agentIds.map((id) => formatAgentLabel(id)).join(", ");
}

function listenLabel(listen: ConnectorListenMode): string {
  switch (listen) {
    case "all":
      return "@mentions and plain messages";
    case "message":
      return "plain messages only";
    case "mention":
      return "@mentions only";
    default:
      return "unknown listen mode";
  }
}

export function missingRouteMetadataMessage(agentId: string): string {
  const label = formatAgentLabel(agentId);
  return `${label} is authorized for this channel but has no saved routing rules. The bot only replies to @mentions until listen settings are saved. Select Fix it to save default routing.`;
}

export function staleRouteMetadataMessage(agentId: string): string {
  const label = formatAgentLabel(agentId);
  return `${label} has saved routing rules that are inactive because the channel authorization entry is missing. The bot ignores this configuration. Select Fix it to remove the stale entry.`;
}

export function openFgaReadFailureMessage(botLabel: string, error: string): string {
  return `Cannot verify channel permissions (${botLabel} could not reach the authorization service). ${error}`;
}

export function noTuplesMessage(tupleNoun: string, runtimeLabel: string): string {
  return `No agents are authorized for this channel. ${runtimeLabel} has nothing to dispatch until an agent is added below.`;
}

export function ambiguousRoutesMessage(
  agentIds: string[],
  mode: "mention" | "message",
  priority: number,
  preferredAgentId?: string,
): string {
  const labels = formatAgentList(agentIds);
  const trigger = mode === "mention" ? "someone @mentions the bot" : "someone sends a plain channel message";
  const preferred = preferredAgentId && agentIds.includes(preferredAgentId)
    ? formatAgentLabel(preferredAgentId)
    : formatAgentLabel([...agentIds].sort()[0] ?? agentIds[0] ?? "");
  return `When ${trigger}, multiple agents can answer (${labels}) at the same priority (${priority}). Only ${preferred} responds first under current tie-break rules. Use Fix routing issues to set a clear primary agent, or adjust listen modes and priorities below.`;
}

export function routeStatusLabel(route: ConnectorRuntimeRouteDiagnostic): {
  authBadge: string;
  routingBadge: string;
  matchSummary: string;
} {
  const authBadge = route.openfga_tuple ? "Authorized" : "Not authorized";
  const routingBadge = route.route_metadata
    ? `Listens: ${listenLabel(route.listen)}`
    : "Default routing (@mentions only)";
  const mention = route.runtime_matches.mention ? "responds to @mentions" : "ignores @mentions";
  const message = route.runtime_matches.message ? "responds to plain messages" : "ignores plain messages";
  return {
    authBadge,
    routingBadge,
    matchSummary: `${mention}; ${message}`,
  };
}
