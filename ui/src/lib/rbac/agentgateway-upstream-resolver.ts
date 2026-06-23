// assisted-by Codex Codex-sonnet-4-6

import { agentGatewayMcpEndpointUrl } from "@/lib/rbac/agentgateway-mcp-discovery";

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function agentGatewayBaseUrl(): string {
  return stripTrailingSlashes(agentGatewayMcpEndpointUrl().replace(/\/mcp$/, ""));
}

export function isAgentGatewayManagedEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint?.trim()) return false;
  const gatewayBase = agentGatewayBaseUrl();
  const trimmed = stripTrailingSlashes(endpoint.trim());
  return trimmed === gatewayBase || trimmed.startsWith(`${gatewayBase}/mcp`);
}

/** Return a trimmed upstream URL when it is not an AgentGateway route. */
export function directUpstreamEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = stripTrailingSlashes(value.trim());
  if (isAgentGatewayManagedEndpoint(trimmed)) return undefined;
  return trimmed;
}

/** Extract `/mcp/<target_id>` suffix from an AgentGateway endpoint, if present. */
export function agentGatewayTargetIdFromEndpoint(endpoint: string): string | null {
  const gatewayBase = agentGatewayBaseUrl();
  const trimmed = stripTrailingSlashes(endpoint.trim());
  const prefix = `${gatewayBase}/mcp/`;
  if (!trimmed.startsWith(prefix)) return null;
  const suffix = trimmed.slice(prefix.length);
  if (!suffix || suffix.includes("/")) return null;
  return /^[A-Za-z0-9._-]+$/.test(suffix) ? suffix : null;
}

export async function resolveAgentGatewayUpstreamEndpoint(input: {
  endpoint?: string;
  pickedTargetEndpoint?: string;
  existingTargetEndpoint?: string;
}): Promise<string | undefined> {
  const picked = directUpstreamEndpoint(input.pickedTargetEndpoint);
  if (picked) return picked;

  const existing = directUpstreamEndpoint(input.existingTargetEndpoint);
  if (existing) return existing;

  const endpoint = input.endpoint?.trim();
  if (!endpoint || !isAgentGatewayManagedEndpoint(endpoint)) return undefined;

  const targetId = agentGatewayTargetIdFromEndpoint(endpoint);
  if (!targetId) return undefined;

  try {
    const { fetchAgentGatewayMcpDiscovery } = await import(
      "@/app/api/mcp-servers/agentgateway/_lib"
    );
    const discovery = await fetchAgentGatewayMcpDiscovery();
    const match = discovery.targets.find((target) => target.id === targetId);
    return directUpstreamEndpoint(match?.target_endpoint);
  } catch {
    return undefined;
  }
}
