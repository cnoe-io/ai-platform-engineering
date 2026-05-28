import { getCollection } from "@/lib/mongodb";
import { readOpenFgaTuples } from "@/lib/rbac/openfga";
import { slackChannelSubjectId } from "@/lib/rbac/slack-channel-grant-store";
import { listSlackChannelAgentRoutes } from "@/lib/rbac/slack-channel-route-store";

export interface SlackRuntimeRouteDiagnostic {
  agent_id: string;
  openfga_tuple: boolean;
  route_metadata: boolean;
  listen: "mention" | "message" | "all" | "unknown";
  priority: number;
  runtime_matches: { mention: boolean; message: boolean };
  warnings: string[];
}

export interface SlackChannelLastRuntimeError {
  ts?: string;
  reason_code?: string;
  message?: string;
  action?: string;
}

export interface SlackChannelDiagnostics {
  workspace_id: string;
  channel_id: string;
  openfga: {
    reachable: boolean;
    tuple_count: number;
    error?: string;
  };
  routes: SlackRuntimeRouteDiagnostic[];
  warnings: string[];
  last_runtime_error: SlackChannelLastRuntimeError | null;
}

export interface SlackChannelHealthSummary {
  warnings_count: number;
  openfga_reachable: boolean;
  last_runtime_error_ts: string | null;
}

function agentIdFromObject(object: string): string | null {
  if (!object.startsWith("agent:")) return null;
  const agentId = object.slice("agent:".length).trim();
  return agentId || null;
}

function listenMatches(
  listen: SlackRuntimeRouteDiagnostic["listen"],
  requested: "mention" | "message",
): boolean {
  return listen === "all" || listen === requested;
}

function buildRouteWarning(route: SlackRuntimeRouteDiagnostic): string[] {
  const warnings: string[] = [];
  if (!route.openfga_tuple) {
    warnings.push(
      `agent:${route.agent_id} has Mongo route metadata, but the OpenFGA tuple is missing; runtime ignores it.`,
    );
  }
  if (!route.route_metadata) {
    warnings.push(
      `agent:${route.agent_id} has an OpenFGA tuple but no Mongo route metadata; runtime uses mention-only defaults.`,
    );
  }
  return warnings;
}

function buildAmbiguousRouteWarnings(routes: SlackRuntimeRouteDiagnostic[]): string[] {
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

async function listOpenFgaChannelAgentIds(workspaceId: string, channelId: string): Promise<string[]> {
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

async function latestRuntimeError(
  workspaceId: string,
  channelId: string,
): Promise<SlackChannelLastRuntimeError | null> {
  const resourceRef = `slack_channel:${slackChannelSubjectId(workspaceId, channelId)}`;
  try {
    const auditEvents = await getCollection("audit_events");
    const rows = await auditEvents
      .find({
        component: "slack_bot",
        outcome: "error",
        resource_ref: resourceRef,
      })
      .sort({ ts: -1 })
      .limit(1)
      .toArray();
    const event = rows[0] as Record<string, unknown> | undefined;
    if (!event) return null;
    return {
      ts: typeof event.ts === "string" ? event.ts : undefined,
      reason_code: typeof event.reason_code === "string" ? event.reason_code : undefined,
      message: typeof event.message === "string" ? event.message : undefined,
      action: typeof event.action === "string" ? event.action : undefined,
    };
  } catch {
    return null;
  }
}

export async function computeSlackChannelDiagnostics(
  workspaceId: string,
  channelId: string,
): Promise<SlackChannelDiagnostics> {
  const metadataRoutes = await listSlackChannelAgentRoutes(workspaceId, channelId);
  const warnings: string[] = [];
  let openfgaAgentIds: string[] = [];
  let openfgaError: string | undefined;

  try {
    openfgaAgentIds = await listOpenFgaChannelAgentIds(workspaceId, channelId);
  } catch (error) {
    openfgaError = error instanceof Error ? error.message : "OpenFGA tuple read failed";
    warnings.push(`Slack bot cannot read OpenFGA tuples: ${openfgaError}`);
  }

  const allAgentIds = Array.from(
    new Set([...openfgaAgentIds, ...metadataRoutes.map((route) => route.agent_id)]),
  ).sort();
  const metadataByAgentId = new Map(metadataRoutes.map((route) => [route.agent_id, route]));
  const openfgaAgentSet = new Set(openfgaAgentIds);
  const routes = allAgentIds.map((agentId): SlackRuntimeRouteDiagnostic => {
    const metadata = metadataByAgentId.get(agentId);
    const listen = (metadata?.users?.listen ?? "mention") as SlackRuntimeRouteDiagnostic["listen"];
    const priority = typeof metadata?.priority === "number" ? metadata.priority : 100;
    const route: SlackRuntimeRouteDiagnostic = {
      agent_id: agentId,
      openfga_tuple: openfgaAgentSet.has(agentId),
      route_metadata: Boolean(metadata),
      listen,
      priority,
      runtime_matches: {
        mention: listenMatches(listen, "mention"),
        message: listenMatches(listen, "message"),
      },
      warnings: [],
    };
    route.warnings = buildRouteWarning(route);
    warnings.push(...route.warnings);
    return route;
  });

  warnings.push(...buildAmbiguousRouteWarnings(routes));

  if (!openfgaError && openfgaAgentIds.length === 0) {
    warnings.push("No OpenFGA channel-agent tuples found. Slack runtime has no agent to dispatch.");
  }

  return {
    workspace_id: workspaceId,
    channel_id: channelId,
    openfga: {
      reachable: !openfgaError,
      tuple_count: openfgaAgentIds.length,
      ...(openfgaError ? { error: openfgaError } : {}),
    },
    routes,
    warnings: Array.from(new Set(warnings)),
    last_runtime_error: await latestRuntimeError(workspaceId, channelId),
  };
}

/**
 * Compact summary used by the channel list endpoint to show per-row
 * health without forcing the UI to fetch full diagnostics for every
 * channel. Same source of truth as `computeSlackChannelDiagnostics`,
 * just stripped to the fields the list view needs.
 */
export async function computeSlackChannelHealthSummary(
  workspaceId: string,
  channelId: string,
): Promise<SlackChannelHealthSummary> {
  const diagnostics = await computeSlackChannelDiagnostics(workspaceId, channelId);
  return {
    warnings_count: diagnostics.warnings.length,
    openfga_reachable: diagnostics.openfga.reachable,
    last_runtime_error_ts: diagnostics.last_runtime_error?.ts ?? null,
  };
}
