import { getCollection } from "@/lib/mongodb";
import {
  agentGatewayAdminConfigUrl,
  buildAgentGatewayMcpDiscovery,
  toAgentGatewayMcpServerDocument,
  type AgentGatewayMcpDiscovery,
} from "@/lib/rbac/agentgateway-mcp-discovery";
import type { MCPServerConfig } from "@/types/dynamic-agent";
import { ApiError } from "@/lib/api-middleware";

const COLLECTION_NAME = "mcp_servers";

export async function fetchAgentGatewayMcpDiscovery(): Promise<AgentGatewayMcpDiscovery> {
  const response = await fetch(agentGatewayAdminConfigUrl(), { method: "GET" });
  if (!response.ok) {
    throw new ApiError(`AgentGateway config request failed with HTTP ${response.status}`, 502);
  }

  const config = await response.json();
  const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);
  const existingServers = await collection.find({}).toArray();
  return buildAgentGatewayMcpDiscovery(config, existingServers);
}

export async function syncSelectedAgentGatewayMcpServers(ids: string[]) {
  const selectedIds = new Set(ids);
  const discovery = await fetchAgentGatewayMcpDiscovery();
  const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);
  const added: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const target of discovery.targets) {
    if (!selectedIds.has(target.id)) continue;
    if (target.status !== "new") {
      skipped.push({ id: target.id, reason: target.status });
      continue;
    }
    await collection.insertOne(toAgentGatewayMcpServerDocument(target));
    added.push(target.id);
  }

  for (const id of selectedIds) {
    if (!discovery.targets.some((target) => target.id === id)) {
      skipped.push({ id, reason: "not_discovered" });
    }
  }

  return { added, skipped, targets: discovery.targets };
}
