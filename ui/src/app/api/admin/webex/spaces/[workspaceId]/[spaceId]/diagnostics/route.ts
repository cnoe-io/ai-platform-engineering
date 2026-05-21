import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import {
  listOpenFgaWebexSpaceAgentIds,
  parseWebexSpaceRouteParams,
  webexSpaceOpenFgaUser,
} from "@/lib/rbac/webex-space-openfga";
import { listWebexSpaceAgentRoutes } from "@/lib/rbac/webex-space-route-store";

import { withWebexSpaceRebacViewAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

interface RuntimeRouteDiagnostic {
  agent_id: string;
  openfga_tuple: boolean;
  route_metadata: boolean;
  listen: "mention" | "message" | "all" | "unknown";
  runtime_matches: { mention: boolean; message: boolean };
  warnings: string[];
}

function listenMatches(listen: RuntimeRouteDiagnostic["listen"], requested: "mention" | "message"): boolean {
  return listen === "all" || listen === requested;
}

function buildRouteWarning(route: RuntimeRouteDiagnostic): string[] {
  const warnings: string[] = [];
  if (!route.openfga_tuple) {
    warnings.push(
      `agent:${route.agent_id} has Mongo route metadata, but the OpenFGA tuple is missing; runtime ignores it.`
    );
  }
  if (!route.route_metadata) {
    warnings.push(
      `agent:${route.agent_id} has an OpenFGA tuple but no Mongo route metadata; runtime uses mention-only defaults.`
    );
  }
  if (route.listen === "mention") {
    warnings.push(`Route agent:${route.agent_id} only listens to mentions. Plain space messages will be ignored.`);
  }
  if (route.listen === "message") {
    warnings.push(`Route agent:${route.agent_id} only listens to plain messages. @mentions will not use this route.`);
  }
  return warnings;
}

async function latestRuntimeError(workspaceId: string, spaceId: string) {
  const resourceRef = webexSpaceOpenFgaUser(workspaceId, spaceId);
  try {
    const auditEvents = await getCollection("audit_events");
    const rows = await auditEvents
      .find({
        component: "webex_bot",
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

function currentRuntimeError(
  lastError: Awaited<ReturnType<typeof latestRuntimeError>>,
  openfgaError: string | undefined
) {
  if (!lastError) return null;
  if (!openfgaError && lastError.reason_code === "OPENFGA_READ_FAILED") {
    return null;
  }
  return lastError;
}

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const raw = await context.params;
  const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);
  return withWebexSpaceRebacViewAuth(request, async () => {
    const metadataRoutes = await listWebexSpaceAgentRoutes(workspaceId, spaceId);
    const warnings: string[] = [];
    let openfgaAgentIds: string[] = [];
    let openfgaError: string | undefined;

    try {
      openfgaAgentIds = await listOpenFgaWebexSpaceAgentIds(workspaceId, spaceId);
    } catch (error) {
      openfgaError = error instanceof Error ? error.message : "OpenFGA tuple read failed";
      warnings.push(`Webex bot cannot read OpenFGA tuples: ${openfgaError}`);
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
      warnings.push("No OpenFGA space-agent tuples found. Webex runtime has no agent to dispatch.");
    }

    const lastError = await latestRuntimeError(workspaceId, spaceId);
    return successResponse({
      workspace_id: workspaceId,
      space_id: spaceId,
      openfga: {
        reachable: !openfgaError,
        tuple_count: openfgaAgentIds.length,
        ...(openfgaError ? { error: openfgaError } : {}),
      },
      routes,
      warnings: Array.from(new Set(warnings)),
      last_runtime_error: currentRuntimeError(lastError, openfgaError),
    });
  }, { workspaceId, spaceId });
});
