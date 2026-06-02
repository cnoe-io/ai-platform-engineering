import { getCollection } from "@/lib/mongodb";

export type ConnectorKind = "slack_channel" | "webex_space";

export type ConnectorListenMode = "mention" | "message" | "all" | "unknown";

export interface ConnectorRouteMetadata {
  agent_id: string;
  priority?: number;
  users?: { listen?: string };
}

export interface ConnectorRuntimeRouteDiagnostic {
  agent_id: string;
  openfga_tuple: boolean;
  route_metadata: boolean;
  listen: ConnectorListenMode;
  priority: number;
  runtime_matches: { mention: boolean; message: boolean };
  warnings: string[];
}

export interface ConnectorLastRuntimeError {
  ts?: string;
  reason_code?: string;
  message?: string;
  action?: string;
}

export interface ConnectorDiagnostics {
  workspace_id: string;
  item_id: string;
  openfga: { reachable: boolean; tuple_count: number; error?: string };
  routes: ConnectorRuntimeRouteDiagnostic[];
  warnings: string[];
  last_runtime_error: ConnectorLastRuntimeError | null;
}

export interface ConnectorHealthSummary {
  warnings_count: number;
  openfga_reachable: boolean;
  last_runtime_error_ts: string | null;
}

export interface ConnectorDiagnosticsAdapter {
  kind: ConnectorKind;
  // Display labels used inside warning text. botLabel is the prefix
  // for the OpenFGA-read failure ("Slack bot cannot read…"); runtimeLabel
  // is used for the no-tuples warning ("Slack runtime has no agent…");
  // tupleNoun is the relation noun in the no-tuples warning
  // ("channel-agent" / "space-agent"). Keeps the warning copy
  // byte-identical with what each panel rendered before.
  botLabel: string;
  runtimeLabel: string;
  tupleNoun: string;
  // The audit_events.component value to query for
  // last_runtime_error. e.g. "slack_bot" / "webex_bot".
  auditComponent: string;
  // resource_ref the bot writes into audit_events — Slack uses
  // `slack_channel:<workspace>--<channel>`, Webex uses
  // `webex_space:<workspace>--<space>`.
  auditResourceRef: (workspaceId: string, itemId: string) => string;
  // Returns `agent_id`s the bot has OpenFGA tuples for. Slack's
  // implementation reads `slack_channel:<id>` as user; Webex reads
  // `webex_space:<id>` as user. Both ultimately enumerate `agent:*`
  // objects.
  listOpenFgaAgentIds: (workspaceId: string, itemId: string) => Promise<string[]>;
  // Returns Mongo route metadata rows for this item. Each row needs
  // an agent_id, optional priority, optional users.listen.
  listRouteMetadata: (workspaceId: string, itemId: string) => Promise<ConnectorRouteMetadata[]>;
  // Optional: Webex suppresses last_runtime_error when OpenFGA is
  // currently reachable but the stored error reason was
  // OPENFGA_READ_FAILED. Slack does not.
  shouldSurfaceLastRuntimeError?: (
    lastError: ConnectorLastRuntimeError,
    openfgaError: string | undefined,
  ) => boolean;
  // Optional: Webex's per-route warnings include explicit
  // mention-only / message-only callouts that Slack does not surface
  // at the per-route level (Slack folds those into the ambiguous-route
  // warning instead). Each connector contributes its own extras.
  buildExtraRouteWarnings?: (route: ConnectorRuntimeRouteDiagnostic) => string[];
  // Slack flags ambiguous routes (two enabled tuples that fight for
  // the same incoming message at the same priority). Webex doesn't
  // ship that warning today; leave optional so Webex's diagnostics
  // stay byte-identical to the existing route handler.
  buildAmbiguousRouteWarnings?: (routes: ConnectorRuntimeRouteDiagnostic[]) => string[];
}

function listenMatches(listen: ConnectorListenMode, requested: "mention" | "message"): boolean {
  return listen === "all" || listen === requested;
}

function buildBaseRouteWarnings(
  route: ConnectorRuntimeRouteDiagnostic,
): string[] {
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

async function latestRuntimeError(
  adapter: ConnectorDiagnosticsAdapter,
  workspaceId: string,
  itemId: string,
): Promise<ConnectorLastRuntimeError | null> {
  const resourceRef = adapter.auditResourceRef(workspaceId, itemId);
  try {
    const auditEvents = await getCollection("audit_events");
    const rows = await auditEvents
      .find({
        component: adapter.auditComponent,
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

export async function computeConnectorDiagnostics(
  adapter: ConnectorDiagnosticsAdapter,
  workspaceId: string,
  itemId: string,
): Promise<ConnectorDiagnostics> {
  const metadataRoutes = await adapter.listRouteMetadata(workspaceId, itemId);
  const warnings: string[] = [];
  let openfgaAgentIds: string[] = [];
  let openfgaError: string | undefined;

  try {
    openfgaAgentIds = await adapter.listOpenFgaAgentIds(workspaceId, itemId);
  } catch (error) {
    openfgaError = error instanceof Error ? error.message : "OpenFGA tuple read failed";
    warnings.push(`${adapter.botLabel} cannot read OpenFGA tuples: ${openfgaError}`);
  }

  const allAgentIds = Array.from(
    new Set([...openfgaAgentIds, ...metadataRoutes.map((route) => route.agent_id)]),
  ).sort();
  const metadataByAgentId = new Map(metadataRoutes.map((route) => [route.agent_id, route]));
  const openfgaAgentSet = new Set(openfgaAgentIds);
  const routes = allAgentIds.map((agentId): ConnectorRuntimeRouteDiagnostic => {
    const metadata = metadataByAgentId.get(agentId);
    const listen = (metadata?.users?.listen ?? "mention") as ConnectorListenMode;
    const priority = typeof metadata?.priority === "number" ? metadata.priority : 100;
    const route: ConnectorRuntimeRouteDiagnostic = {
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
    const baseWarnings = buildBaseRouteWarnings(route);
    const extra = adapter.buildExtraRouteWarnings?.(route) ?? [];
    route.warnings = [...baseWarnings, ...extra];
    warnings.push(...route.warnings);
    return route;
  });

  if (adapter.buildAmbiguousRouteWarnings) {
    warnings.push(...adapter.buildAmbiguousRouteWarnings(routes));
  }

  if (!openfgaError && openfgaAgentIds.length === 0) {
    warnings.push(
      `No OpenFGA ${adapter.tupleNoun} tuples found. ${adapter.runtimeLabel} has no agent to dispatch.`,
    );
  }

  const lastError = await latestRuntimeError(adapter, workspaceId, itemId);
  const surfacedLastError =
    lastError && (adapter.shouldSurfaceLastRuntimeError?.(lastError, openfgaError) ?? true)
      ? lastError
      : null;

  return {
    workspace_id: workspaceId,
    item_id: itemId,
    openfga: {
      reachable: !openfgaError,
      tuple_count: openfgaAgentIds.length,
      ...(openfgaError ? { error: openfgaError } : {}),
    },
    routes,
    warnings: Array.from(new Set(warnings)),
    last_runtime_error: surfacedLastError,
  };
}

export async function computeConnectorHealthSummary(
  adapter: ConnectorDiagnosticsAdapter,
  workspaceId: string,
  itemId: string,
): Promise<ConnectorHealthSummary> {
  const diagnostics = await computeConnectorDiagnostics(adapter, workspaceId, itemId);
  return {
    warnings_count: diagnostics.warnings.length,
    openfga_reachable: diagnostics.openfga.reachable,
    last_runtime_error_ts: diagnostics.last_runtime_error?.ts ?? null,
  };
}
