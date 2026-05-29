import fs from "fs";
import path from "path";
import yaml from "js-yaml";
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
              matches: [{ path: { type: "PathPrefix", value: "/mcp/rag" } }],
              backends: [
                {
                  mcp: {
                    targets: [
                      { name: "rag", mcp: { host: "http://rag-server:9446/mcp" } },
                    ],
                  },
                },
              ],
            },
            {
              matches: [{ path: { type: "PathPrefix", value: "/mcp/jira" } }],
              backends: [
                {
                  mcp: {
                    targets: [
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
      { id: "rag", route_path: "/mcp/rag", target_endpoint: "http://rag-server:9446/mcp" },
      { id: "jira", route_path: "/mcp/jira", target_endpoint: "http://mcp-jira:8000/mcp" },
    ]);
  });

  it.each(["config.yaml", "config.caipe-rbac.yaml"])(
    "keeps %s populated with the dev MCP services",
    (filename) => {
      const configPath = path.join(process.cwd(), "../deploy/agentgateway", filename);
      const config = yaml.load(fs.readFileSync(configPath, "utf-8"));

      expect(extractAgentGatewayMcpTargets(config).map((target) => target.id).sort()).toEqual(
        [
          "argocd",
          "backstage",
          "confluence",
          "github",
          "gitlab",
          "jira",
          "knowledge-base",
          "komodor",
          "netutils",
          "pagerduty",
          "rag",
          "slack",
          "splunk",
          "victorops",
          "webex",
        ],
      );
    },
  );

  it("classifies against the AgentGateway target-specific routed endpoint", () => {
    process.env.AGENT_GATEWAY_URL = "http://agentgateway:4000";
    const discovery = buildAgentGatewayMcpDiscovery(agentGatewayConfig, [
      existingServer("jira", "http://agentgateway:4000/mcp/jira"),
      existingServer("rag", "http://legacy-rag:9446/mcp"),
    ]);

    expect(discovery.targets).toEqual([
      expect.objectContaining({
        id: "rag",
        endpoint: "http://agentgateway:4000/mcp/rag",
        target_endpoint: "http://rag-server:9446/mcp",
        status: "conflict",
        existing_endpoint: "http://legacy-rag:9446/mcp",
      }),
      expect.objectContaining({
        id: "jira",
        endpoint: "http://agentgateway:4000/mcp/jira",
        target_endpoint: "http://mcp-jira:8000/mcp",
        status: "existing",
      }),
    ]);
  });

  it("classifies a same-upstream direct registration as a legacy migration", () => {
    process.env.AGENT_GATEWAY_URL = "http://agentgateway:4000";
    const discovery = buildAgentGatewayMcpDiscovery(agentGatewayConfig, [
      existingServer("jira", "http://mcp-jira:8000/mcp"),
    ]);

    expect(discovery.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "jira",
          endpoint: "http://agentgateway:4000/mcp/jira",
          target_endpoint: "http://mcp-jira:8000/mcp",
          status: "legacy",
          existing_endpoint: "http://mcp-jira:8000/mcp",
        }),
      ]),
    );
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
    expect(agentGatewayMcpEndpointUrl("/mcp/jira")).toBe("http://agentgateway:4000/mcp/jira");
  });

  it("stores AgentGateway-routed endpoint while preserving target endpoint metadata", () => {
    const discovery = buildAgentGatewayMcpDiscovery(agentGatewayConfig, []);
    const doc = toAgentGatewayMcpServerDocument(discovery.targets[0], "2026-05-17T00:00:00.000Z");

    expect(doc).toEqual(
      expect.objectContaining({
        _id: "rag",
        endpoint: "http://agentgateway:4000/mcp/rag",
        source: "agentgateway",
        agentgateway_discovered: true,
        agentgateway_endpoint: "http://agentgateway:4000/mcp/rag",
        agentgateway_target_endpoint: "http://rag-server:9446/mcp",
      }),
    );
  });
});
