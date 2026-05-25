import type { MCPServerConfig } from "@/types/dynamic-agent";

export type AgentGatewayMcpTargetStatus = "new" | "existing" | "legacy" | "conflict";

export interface AgentGatewayMcpTarget {
  id: string;
  route_path?: string;
  target_endpoint: string;
}

export interface AgentGatewayMcpDiscoveryTarget extends AgentGatewayMcpTarget {
  name: string;
  transport: "http";
  endpoint: string;
  enabled: true;
  status: AgentGatewayMcpTargetStatus;
  existing_endpoint?: string;
}

export interface AgentGatewayMcpDiscovery {
  targets: AgentGatewayMcpDiscoveryTarget[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeTargetId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
}

function displayNameForId(id: string): string {
  if (id.toLowerCase() === "rag") return "RAG";
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function routePathForRoute(route: Record<string, unknown>): string | undefined {
  for (const match of asArray(route.matches)) {
    if (!isRecord(match) || !isRecord(match.path)) continue;
    const value = match.path.value;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function extractAgentGatewayMcpTargets(config: unknown): AgentGatewayMcpTarget[] {
  if (!isRecord(config)) return [];

  const targets: AgentGatewayMcpTarget[] = [];
  for (const bind of asArray(config.binds)) {
    if (!isRecord(bind)) continue;
    for (const listener of asArray(bind.listeners)) {
      if (!isRecord(listener)) continue;
      for (const route of asArray(listener.routes)) {
        if (!isRecord(route)) continue;
        const route_path = routePathForRoute(route);
        for (const backend of asArray(route.backends)) {
          if (!isRecord(backend) || !isRecord(backend.mcp)) continue;
          for (const target of asArray(backend.mcp.targets)) {
            if (!isRecord(target) || !isRecord(target.mcp)) continue;
            const id = normalizeTargetId(target.name);
            const targetEndpoint = typeof target.mcp.host === "string" ? target.mcp.host.trim() : "";
            if (!id || !targetEndpoint) continue;
            targets.push({ id, ...(route_path ? { route_path } : {}), target_endpoint: targetEndpoint });
          }
        }
      }
    }
  }

  return targets;
}

export function buildAgentGatewayMcpDiscovery(
  config: unknown,
  existingServers: MCPServerConfig[],
): AgentGatewayMcpDiscovery {
  const existingById = new Map(existingServers.map((server) => [server._id, server]));
  const targets = extractAgentGatewayMcpTargets(config).map((target) => {
    const existing = existingById.get(target.id);
    const endpoint = agentGatewayMcpEndpointUrl(target.route_path);
    const status: AgentGatewayMcpTargetStatus = !existing
      ? "new"
      : existing.transport === "http" && existing.endpoint === endpoint
        ? "existing"
        : existing.transport === "http" && existing.endpoint === target.target_endpoint
          ? "legacy"
          : "conflict";

    return {
      ...target,
      name: displayNameForId(target.id),
      transport: "http" as const,
      endpoint,
      enabled: true as const,
      status,
      ...(existing?.endpoint && existing.endpoint !== endpoint
        ? { existing_endpoint: existing.endpoint }
        : {}),
    };
  });

  return { targets };
}

export function agentGatewayAdminConfigUrl(): string {
  const configured =
    process.env.AGENT_GATEWAY_ADMIN_URL?.trim() ||
    process.env.AGENTGATEWAY_ADMIN_URL?.trim() ||
    "http://agentgateway:15000/config";
  const withoutTrailingSlash = configured.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/config")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/config`;
}

export function agentGatewayMcpEndpointUrl(routePath?: string): string {
  const configured =
    process.env.AGENT_GATEWAY_URL?.trim() ||
    process.env.AGENTGATEWAY_URL?.trim() ||
    "http://agentgateway:4000";
  const withoutTrailingSlash = configured.replace(/\/+$/, "");
  if (routePath?.trim()) {
    const normalizedRoutePath = routePath.trim().startsWith("/")
      ? routePath.trim()
      : `/${routePath.trim()}`;
    const base =
      withoutTrailingSlash.endsWith("/mcp") && normalizedRoutePath.startsWith("/mcp/")
        ? withoutTrailingSlash.slice(0, -"/mcp".length)
        : withoutTrailingSlash;
    return `${base}${normalizedRoutePath}`;
  }
  return withoutTrailingSlash.endsWith("/mcp")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/mcp`;
}

export function toAgentGatewayMcpServerDocument(
  target: AgentGatewayMcpDiscoveryTarget,
  now = new Date().toISOString(),
): MCPServerConfig & {
  source: "agentgateway";
  agentgateway_discovered: true;
} {
  return {
    _id: target.id,
    name: target.name,
    description: `Discovered from AgentGateway target ${target.id}`,
    transport: "http",
    endpoint: target.endpoint,
    enabled: true,
    config_driven: true,
    created_at: now,
    updated_at: now,
    source: "agentgateway",
    agentgateway_discovered: true,
    agentgateway_endpoint: target.endpoint,
    agentgateway_target_endpoint: target.target_endpoint,
  };
}
