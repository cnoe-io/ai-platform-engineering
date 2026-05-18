import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { readOpenFgaTuples } from "@/lib/rbac/openfga";
import { slackChannelSubjectId } from "@/lib/rbac/slack-channel-grant-store";
import { listSlackChannelAgentRoutes } from "@/lib/rbac/slack-channel-route-store";

import { withSlackChannelRebacViewAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

interface RuntimeRouteDiagnostic {
  agent_id: string;
  openfga_tuple: boolean;
  route_metadata: boolean;
  listen: "mention" | "message" | "all" | "unknown";
  runtime_matches: { mention: boolean; message: boolean };
  warnings: string[];
}

function agentIdFromObject(object: string): string | null {
  if (!object.startsWith("agent:")) return null;
  const agentId = object.slice("agent:".length).trim();
  return agentId || null;
}

function listenMatches(listen: RuntimeRouteDiagnostic["listen"], requested: "mention" | "message"): boolean {
  return listen === "all" || listen === requested;
}

function buildRouteWarning(route: RuntimeRouteDiagnostic): string[] {
  const warnings: string[] = [];
  if (!route.openfga_tuple) {
    warnings.push(`agent:${route.agent_id} has Mongo route metadata, but the OpenFGA tuple is missing; runtime ignores it.`);
  }
  if (!route.route_metadata) {
    warnings.push(`agent:${route.agent_id} has an OpenFGA tuple but no Mongo route metadata; runtime uses mention-only defaults.`);
  }
  if (route.listen === "mention") {
    warnings.push(`Route agent:${route.agent_id} only listens to mentions. Plain channel messages will be ignored.`);
  }
  if (route.listen === "message") {
    warnings.push(`Route agent:${route.agent_id} only listens to plain messages. @mentions will not use this route.`);
  }
  return warnings;
}

async function listOpenFgaChannelAgentIds(workspaceId: string, channelId: string) {
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

async function latestRuntimeError(workspaceId: string, channelId: string) {
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

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) =>
  withSlackChannelRebacViewAuth(request, async () => {
    const { workspaceId, channelId } = await context.params;
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
      new Set([...openfgaAgentIds, ...metadataRoutes.map((route) => route.agent_id)])
    ).sort();
    const metadataByAgentId = new Map(metadataRoutes.map((route) => [route.agent_id, route]));
    const openfgaAgentSet = new Set(openfgaAgentIds);
    const routes = allAgentIds.map((agentId): RuntimeRouteDiagnostic => {
      const metadata = metadataByAgentId.get(agentId);
      const listen = (metadata?.users?.listen ?? "mention") as RuntimeRouteDiagnostic["listen"];
      const route = {
        agent_id: agentId,
        openfga_tuple: openfgaAgentSet.has(agentId),
        route_metadata: Boolean(metadata),
        listen,
        runtime_matches: {
          mention: listenMatches(listen, "mention"),
          message: listenMatches(listen, "message"),
        },
        warnings: [] as string[],
      };
      route.warnings = buildRouteWarning(route);
      warnings.push(...route.warnings);
      return route;
    });

    if (!openfgaError && openfgaAgentIds.length === 0) {
      warnings.push("No OpenFGA channel-agent tuples found. Slack runtime has no agent to dispatch.");
    }

    return successResponse({
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
    });
  })
);
