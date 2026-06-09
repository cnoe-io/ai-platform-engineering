import {
type ConnectorDiagnostics,
type ConnectorDiagnosticsAdapter,
type ConnectorHealthSummary,
type ConnectorRouteMetadata,
type ConnectorRuntimeRouteDiagnostic,
computeConnectorDiagnostics,
computeConnectorHealthSummary,
} from "@/lib/rbac/connector-diagnostics";
import { readOpenFgaTuples } from "@/lib/rbac/openfga";
import { slackChannelSubjectId } from "@/lib/rbac/slack-channel-grant-store";
import { listSlackChannelAgentRoutes } from "@/lib/rbac/slack-channel-route-store";

export type SlackRuntimeRouteDiagnostic = ConnectorRuntimeRouteDiagnostic;

export type SlackChannelLastRuntimeError = NonNullable<ConnectorDiagnostics["last_runtime_error"]>;

export interface SlackChannelDiagnostics extends Omit<ConnectorDiagnostics, "item_id"> {
  channel_id: string;
}

export type SlackChannelHealthSummary = ConnectorHealthSummary;

function agentIdFromObject(object: string): string | null {
  if (!object.startsWith("agent:")) return null;
  const agentId = object.slice("agent:".length).trim();
  return agentId || null;
}

async function listOpenFgaSlackChannelAgentIds(workspaceId: string, channelId: string): Promise<string[]> {
  const subject = `slack_channel:${slackChannelSubjectId(workspaceId, channelId)}`;
  const seen = new Set<string>();
  let continuationToken: string | undefined;
  do {
    const result = await readOpenFgaTuples({
      pageSize: 100,
      ...(continuationToken ? { continuationToken } : {}),
    });
    for (const tuple of result.tuples) {
      if (tuple.key.user !== subject || tuple.key.relation !== "user") continue;
      const agentId = agentIdFromObject(tuple.key.object);
      if (agentId) seen.add(agentId);
    }
    continuationToken = result.continuationToken;
  } while (continuationToken);
  return Array.from(seen);
}

function buildAmbiguousRouteWarnings(routes: ConnectorRuntimeRouteDiagnostic[]): string[] {
  // Surface real misconfiguration: two enabled routes that match the
  // same incoming message at the same priority. The Slack bot picks
  // first-match-wins among ties, so the result is non-deterministic.
  const eligible = routes.filter((route) => route.openfga_tuple);
  const warnings: string[] = [];
  for (const mode of ["mention", "message"] as const) {
    const candidates = eligible.filter((route) => route.runtime_matches[mode]);
    if (candidates.length < 2) continue;
    const byPriority = new Map<number, string[]>();
    for (const route of candidates) {
      const ids = byPriority.get(route.priority) ?? [];
      ids.push(route.agent_id);
      byPriority.set(route.priority, ids);
    }
    for (const [priority, agentIds] of byPriority) {
      if (agentIds.length < 2) continue;
      warnings.push(
        `Routes ${agentIds.map((id) => `agent:${id}`).join(", ")} all match ${mode === "mention" ? "@mentions" : "plain messages"} at priority ${priority}; the Slack bot will pick one non-deterministically. Adjust priority or listen mode so each message has a single winner.`,
      );
    }
  }
  return warnings;
}

const SLACK_DIAGNOSTICS_ADAPTER: ConnectorDiagnosticsAdapter = {
  kind: "slack_channel",
  botLabel: "Slack bot",
  runtimeLabel: "Slack runtime",
  tupleNoun: "channel-agent",
  auditComponent: "slack_bot",
  auditResourceRef: (workspaceId, channelId) =>
    `slack_channel:${slackChannelSubjectId(workspaceId, channelId)}`,
  listOpenFgaAgentIds: listOpenFgaSlackChannelAgentIds,
  listRouteMetadata: async (workspaceId, channelId): Promise<ConnectorRouteMetadata[]> => {
    const rows = await listSlackChannelAgentRoutes(workspaceId, channelId);
    return rows.map((route) => ({
      agent_id: route.agent_id,
      priority: route.priority,
      users: route.users ? { listen: route.users.listen } : undefined,
    }));
  },
  buildAmbiguousRouteWarnings,
};

export async function computeSlackChannelDiagnostics(
  workspaceId: string,
  channelId: string,
): Promise<SlackChannelDiagnostics> {
  const diagnostics = await computeConnectorDiagnostics(SLACK_DIAGNOSTICS_ADAPTER, workspaceId, channelId);
  return {
    workspace_id: diagnostics.workspace_id,
    channel_id: diagnostics.item_id,
    openfga: diagnostics.openfga,
    routes: diagnostics.routes,
    warnings: diagnostics.warnings,
    last_runtime_error: diagnostics.last_runtime_error,
  };
}

export async function computeSlackChannelHealthSummary(
  workspaceId: string,
  channelId: string,
): Promise<SlackChannelHealthSummary> {
  return computeConnectorHealthSummary(SLACK_DIAGNOSTICS_ADAPTER, workspaceId, channelId);
}
