import {
type ConnectorDiagnostics,
type ConnectorDiagnosticsAdapter,
type ConnectorHealthSummary,
type ConnectorRouteMetadata,
type ConnectorRuntimeRouteDiagnostic,
computeConnectorDiagnostics,
computeConnectorHealthSummary,
} from "@/lib/rbac/connector-diagnostics";
import {
listOpenFgaWebexSpaceAgentIds,
webexSpaceOpenFgaUser,
} from "@/lib/rbac/webex-space-openfga";
import { listWebexSpaceAgentRoutes } from "@/lib/rbac/webex-space-route-store";

export type WebexRuntimeRouteDiagnostic = ConnectorRuntimeRouteDiagnostic;

export type WebexSpaceLastRuntimeError = NonNullable<ConnectorDiagnostics["last_runtime_error"]>;

export interface WebexSpaceDiagnostics extends Omit<ConnectorDiagnostics, "item_id"> {
  space_id: string;
}

export type WebexSpaceHealthSummary = ConnectorHealthSummary;

function buildExtraRouteWarnings(route: ConnectorRuntimeRouteDiagnostic): string[] {
  // Webex surfaces explicit listen-mode warnings at the per-route
  // level. Slack instead folds these into the ambiguous-route warning
  // — so this function is Webex-specific and does not run for Slack.
  const warnings: string[] = [];
  if (route.listen === "mention") {
    warnings.push(
      `Route agent:${route.agent_id} only listens to mentions. Plain space messages will be ignored.`,
    );
  }
  if (route.listen === "message") {
    warnings.push(
      `Route agent:${route.agent_id} only listens to plain messages. @mentions will not use this route.`,
    );
  }
  return warnings;
}

const WEBEX_DIAGNOSTICS_ADAPTER: ConnectorDiagnosticsAdapter = {
  kind: "webex_space",
  botLabel: "Webex bot",
  runtimeLabel: "Webex runtime",
  tupleNoun: "space-agent",
  auditComponent: "webex_bot",
  auditResourceRef: (workspaceId, spaceId) => webexSpaceOpenFgaUser(workspaceId, spaceId),
  listOpenFgaAgentIds: listOpenFgaWebexSpaceAgentIds,
  listRouteMetadata: async (workspaceId, spaceId): Promise<ConnectorRouteMetadata[]> => {
    const rows = await listWebexSpaceAgentRoutes(workspaceId, spaceId);
    return rows.map((route) => ({
      agent_id: route.agent_id,
      priority: route.priority,
      users: route.users ? { listen: route.users.listen } : undefined,
    }));
  },
  buildExtraRouteWarnings,
  shouldSurfaceLastRuntimeError: (lastError, openfgaError) => {
    // The Webex bot logs OPENFGA_READ_FAILED into audit_events when
    // tuple reads fail. Once OpenFGA is reachable again, the stored
    // error is stale — suppress it so the diagnostics panel doesn't
    // light up red after the underlying issue cleared.
    if (!openfgaError && lastError.reason_code === "OPENFGA_READ_FAILED") return false;
    return true;
  },
};

export async function computeWebexSpaceDiagnostics(
  workspaceId: string,
  spaceId: string,
): Promise<WebexSpaceDiagnostics> {
  const diagnostics = await computeConnectorDiagnostics(WEBEX_DIAGNOSTICS_ADAPTER, workspaceId, spaceId);
  return {
    workspace_id: diagnostics.workspace_id,
    space_id: diagnostics.item_id,
    openfga: diagnostics.openfga,
    routes: diagnostics.routes,
    warnings: diagnostics.warnings,
    last_runtime_error: diagnostics.last_runtime_error,
  };
}

export async function computeWebexSpaceHealthSummary(
  workspaceId: string,
  spaceId: string,
): Promise<WebexSpaceHealthSummary> {
  return computeConnectorHealthSummary(WEBEX_DIAGNOSTICS_ADAPTER, workspaceId, spaceId);
}
