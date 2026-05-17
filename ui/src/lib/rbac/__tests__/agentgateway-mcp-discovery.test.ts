import {
  agentGatewayAdminConfigUrl,
  agentGatewayMcpEndpointUrl,
  buildAgentGatewayMcpDiscovery,
  extractAgentGatewayMcpTargets,
  toAgentGatewayMcpServerDocument,
} from "../agentgateway-mcp-discovery";
import type { MCPServerConfig } from "@/types/dynamic-agent";

const agentGatewayConfig = {
  binds: [
    {
      listeners: [
        {
          routes: [
            {
              backends: [
                {
                  mcp: {
                    targets: [
                      { name: "rag", mcp: { host: "http://rag-server:9446/mcp" } },
                      { name: "jira", mcp: { host: "http://mcp-jira:8000/mcp" } },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

function existingServer(id: string, endpoint: string): MCPServerConfig {
  return {
    _id: id,
    name: id,
    transport: "http",
    endpoint,
    enabled: true,
    created_at: "2026-05-17T00:00:00.000Z",
    updated_at: "2026-05-17T00:00:00.000Z",
  };
}

describe("AgentGateway MCP discovery", () => {
  const originalEnv = process.env.AGENT_GATEWAY_ADMIN_URL;
  const originalGatewayUrl = process.env.AGENT_GATEWAY_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AGENT_GATEWAY_ADMIN_URL;
    } else {
      process.env.AGENT_GATEWAY_ADMIN_URL = originalEnv;
    }
    if (originalGatewayUrl === undefined) {
      delete process.env.AGENT_GATEWAY_URL;
    } else {
      process.env.AGENT_GATEWAY_URL = originalGatewayUrl;
    }
  });

  it("extracts MCP targets from AgentGateway config", () => {
    expect(extractAgentGatewayMcpTargets(agentGatewayConfig)).toEqual([
      { id: "rag", target_endpoint: "http://rag-server:9446/mcp" },
      { id: "jira", target_endpoint: "http://mcp-jira:8000/mcp" },
    ]);
  });

  it("classifies against the AgentGateway routed endpoint", () => {
    process.env.AGENT_GATEWAY_URL = "http://agentgateway:4000";
    const discovery = buildAgentGatewayMcpDiscovery(agentGatewayConfig, [
      existingServer("jira", "http://agentgateway:4000/mcp"),
      existingServer("rag", "http://legacy-rag:9446/mcp"),
    ]);

    expect(discovery.targets).toEqual([
      expect.objectContaining({
        id: "rag",
        endpoint: "http://agentgateway:4000/mcp",
        target_endpoint: "http://rag-server:9446/mcp",
        status: "conflict",
        existing_endpoint: "http://legacy-rag:9446/mcp",
      }),
      expect.objectContaining({
        id: "jira",
        endpoint: "http://agentgateway:4000/mcp",
        target_endpoint: "http://mcp-jira:8000/mcp",
        status: "existing",
      }),
    ]);
  });

  it("normalizes AgentGateway admin config URLs", () => {
    process.env.AGENT_GATEWAY_ADMIN_URL = "http://agentgateway:15000/";

    expect(agentGatewayAdminConfigUrl()).toBe("http://agentgateway:15000/config");

    process.env.AGENT_GATEWAY_ADMIN_URL = "http://agentgateway:15000/config/";
    expect(agentGatewayAdminConfigUrl()).toBe("http://agentgateway:15000/config");
  });

  it("normalizes AgentGateway MCP data-plane URLs", () => {
    process.env.AGENT_GATEWAY_URL = "http://agentgateway:4000/";

    expect(agentGatewayMcpEndpointUrl()).toBe("http://agentgateway:4000/mcp");

    process.env.AGENT_GATEWAY_URL = "http://agentgateway:4000/mcp/";
    expect(agentGatewayMcpEndpointUrl()).toBe("http://agentgateway:4000/mcp");
  });

  it("stores AgentGateway-routed endpoint while preserving target endpoint metadata", () => {
    const discovery = buildAgentGatewayMcpDiscovery(agentGatewayConfig, []);
    const doc = toAgentGatewayMcpServerDocument(discovery.targets[0], "2026-05-17T00:00:00.000Z");

    expect(doc).toEqual(
      expect.objectContaining({
        _id: "rag",
        endpoint: "http://agentgateway:4000/mcp",
        source: "agentgateway",
        agentgateway_discovered: true,
        agentgateway_endpoint: "http://agentgateway:4000/mcp",
        agentgateway_target_endpoint: "http://rag-server:9446/mcp",
      }),
    );
  });
});
