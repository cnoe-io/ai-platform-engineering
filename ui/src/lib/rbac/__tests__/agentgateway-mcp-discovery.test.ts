import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  agentGatewayAdminConfigUrl,
  agentGatewayMcpEndpointUrl,
  buildAgentGatewayMcpDiscovery,
  displayNameForId,
  extractAgentGatewayMcpTargets,
  toAgentGatewayMcpServerDocument,
} from "../agentgateway-mcp-discovery";
import type { AgentGatewayMcpDiscoveryTarget } from "../agentgateway-mcp-discovery";
import type { MCPServerConfig } from "@/types/dynamic-agent";

// Mirrors the real agentgateway standalone proxy v0.12 admin /config output,
// which emits route matches as `{ pathPrefix: "/mcp/<id>" }` (verified live
// against ghcr.io/agentgateway/agentgateway). Older/Gateway-API-normalized
// output used `{ type, value }`; the parser accepts both.
const agentGatewayConfig = {
  binds: [
    {
      listeners: [
        {
          routes: [
            {
              matches: [{ path: { pathPrefix: "/mcp/rag" } }],
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
              matches: [{ path: { pathPrefix: "/mcp/jira" } }],
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

  it("recovers the route path from both pathPrefix and {type,value} match shapes", () => {
    const mk = (pathMatch: Record<string, unknown>, id: string, host: string) => ({
      binds: [
        {
          listeners: [
            {
              routes: [
                {
                  matches: [{ path: pathMatch }],
                  backends: [{ mcp: { targets: [{ name: id, mcp: { host } }] } }],
                },
              ],
            },
          ],
        },
      ],
    });

    // Live agentgateway v0.12 standalone proxy shape.
    expect(extractAgentGatewayMcpTargets(mk({ pathPrefix: "/mcp/argocd" }, "argocd", "http://mcp-argocd:8000/mcp"))).toEqual([
      { id: "argocd", route_path: "/mcp/argocd", target_endpoint: "http://mcp-argocd:8000/mcp" },
    ]);
    // Gateway-API-normalized shape.
    expect(extractAgentGatewayMcpTargets(mk({ type: "PathPrefix", value: "/mcp/argocd" }, "argocd", "http://mcp-argocd:8000/mcp"))).toEqual([
      { id: "argocd", route_path: "/mcp/argocd", target_endpoint: "http://mcp-argocd:8000/mcp" },
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
          "gitlab",
          "jira",
          "knowledge-base",
          "komodor",
          "netutils",
          "pagerduty",
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

  it("classifies a same-upstream direct registration as a conflict, not an auto-migration", () => {
    // A direct (non-gitops) registration whose endpoint doesn't match the
    // AgentGateway-proxied URL is no longer silently rewritten -- it surfaces
    // as a conflict requiring explicit admin action (rename/remove).
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
          status: "conflict",
          existing_endpoint: "http://mcp-jira:8000/mcp",
        }),
      ]),
    );
  });

  it("classifies a bare-gateway endpoint as a conflict, not an auto-migration", () => {
    // Stale rows written before per-target routing stored the catch-all
    // `http://agentgateway:4000/mcp`. The runtime already self-heals these at
    // read time (see mcp_client.py's _heal_endpoint), so leaving the stored
    // value as a flagged conflict -- rather than silently rewriting it -- is
    // safe and requires no urgent action.
    process.env.AGENT_GATEWAY_URL = "http://agentgateway:4000";
    const discovery = buildAgentGatewayMcpDiscovery(agentGatewayConfig, [
      existingServer("jira", "http://agentgateway:4000/mcp"),
      // Trailing slash + the gateway origin with no /mcp suffix are the same shape.
      existingServer("rag", "http://agentgateway:4000"),
    ]);

    expect(discovery.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "jira",
          endpoint: "http://agentgateway:4000/mcp/jira",
          status: "conflict",
          existing_endpoint: "http://agentgateway:4000/mcp",
        }),
        expect.objectContaining({
          id: "rag",
          endpoint: "http://agentgateway:4000/mcp/rag",
          status: "conflict",
          existing_endpoint: "http://agentgateway:4000",
        }),
      ]),
    );
  });

  it("keeps a different upstream host as a conflict (not auto-migrated)", () => {
    // A row pointing at a *different* upstream than the discovered target is a
    // genuine conflict the operator must resolve — never silently overwritten.
    process.env.AGENT_GATEWAY_URL = "http://agentgateway:4000";
    const discovery = buildAgentGatewayMcpDiscovery(agentGatewayConfig, [
      existingServer("jira", "http://some-other-host:9999/mcp"),
    ]);

    expect(discovery.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "jira",
          status: "conflict",
          existing_endpoint: "http://some-other-host:9999/mcp",
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

  it("never attaches a credential_sources default -- discovery is config-driven only", () => {
    // No code-level defaults: a freshly discovered doc never carries
    // credential_sources. Any server needing one (e.g. knowledge-base/RAG)
    // must declare it explicitly in gitops, so config_driven seed is the only
    // source of truth and there's nothing for discovery to silently guess or
    // collide with (e.g. attaching a per-user Atlassian credential to the
    // confluence/jira bare-id service-account convention).
    for (const id of ["knowledge-base", "github", "jira", "confluence", "webex_meetings", "argocd"]) {
      const target: AgentGatewayMcpDiscoveryTarget = {
        id,
        name: id,
        transport: "http",
        endpoint: `http://agentgateway:4000/mcp/${id}`,
        enabled: true,
        status: "new",
        target_endpoint: `http://mcp-${id}:8000/mcp`,
      };
      const doc = toAgentGatewayMcpServerDocument(target, "2026-05-17T00:00:00.000Z");
      expect(doc.credential_sources).toBeUndefined();
    }
  });
});

describe("displayNameForId", () => {
  it("special-cases rag", () => {
    expect(displayNameForId("rag")).toBe("RAG");
  });

  it("capitalizes known acronyms and product names instead of naive title-casing", () => {
    expect(displayNameForId("mcp-example-ai-gateway")).toBe("MCP Example AI Gateway");
    expect(displayNameForId("mcp-example-github")).toBe("MCP Example GitHub");
    expect(displayNameForId("mcp-example-aws")).toBe("MCP Example AWS");
    expect(displayNameForId("mcp-example-misc-tools")).toBe("MCP Example Misc Tools");
  });

  it("falls back to simple capitalization for words with no override", () => {
    expect(displayNameForId("knowledge-base")).toBe("Knowledge Base");
    expect(displayNameForId("confluence-user-impersonation")).toBe(
      "Confluence User Impersonation",
    );
  });
});
