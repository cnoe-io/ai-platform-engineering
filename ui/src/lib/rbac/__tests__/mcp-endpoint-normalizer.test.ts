/**
 * Tests for the MCP endpoint normaliser.
 *
 * Background: when an MCP server is routed through AgentGateway, the
 * gateway dispatches by path prefix — `/mcp/<target>` — so the endpoint
 * stored against the server document MUST be target-qualified
 * (`http://agentgateway:4000/mcp/<server_id>`). If it isn't, every probe
 * and tool call falls through to AgentGateway's `/mcp` route, which
 * isn't registered and returns 404. That class of bug surfaced first as
 * "Failed to connect to MCP server: HTTP 404 Not Found from
 * http://agentgateway:4000/mcp" in the Probe button.
 *
 * The normaliser keeps the invariant in one place: anywhere we read or
 * write an MCP server endpoint that points at AgentGateway, we ensure it
 * carries the server_id suffix.
 */

import {
  normalizeMcpEndpointForServer,
  isAgentGatewayBaseEndpoint,
} from "@/lib/rbac/mcp-endpoint-normalizer";

describe("normalizeMcpEndpointForServer", () => {
  // Helper: keep tests below readable by hiding the boilerplate arg shape.
  const fix = (endpoint: string | undefined, serverId: string, base = "http://agentgateway:4000") =>
    normalizeMcpEndpointForServer({ endpoint, serverId, agentGatewayBaseUrl: base });

  it("appends the server id when the endpoint is the bare agentgateway base", () => {
    expect(fix("http://agentgateway:4000/mcp", "confluence")).toBe(
      "http://agentgateway:4000/mcp/confluence",
    );
  });

  it("appends the server id when the endpoint is the agentgateway root (no /mcp)", () => {
    // We never expect this in practice but defend against it just in case
    // someone wrote `http://agentgateway:4000` because their muscle memory
    // dropped the path.
    expect(fix("http://agentgateway:4000", "confluence")).toBe(
      "http://agentgateway:4000/mcp/confluence",
    );
  });

  it("strips trailing slashes before suffixing", () => {
    expect(fix("http://agentgateway:4000/mcp/", "confluence")).toBe(
      "http://agentgateway:4000/mcp/confluence",
    );
    expect(fix("http://agentgateway:4000/", "confluence")).toBe(
      "http://agentgateway:4000/mcp/confluence",
    );
  });

  it("leaves a correctly-qualified endpoint alone", () => {
    expect(fix("http://agentgateway:4000/mcp/confluence", "confluence")).toBe(
      "http://agentgateway:4000/mcp/confluence",
    );
  });

  it("repairs an endpoint that names the wrong target id", () => {
    // E.g. the admin renamed the server from "atlassian-confluence" to
    // "confluence" but the endpoint still hardcodes the old path.
    expect(
      fix("http://agentgateway:4000/mcp/atlassian-confluence", "confluence"),
    ).toBe("http://agentgateway:4000/mcp/confluence");
  });

  it("leaves a direct upstream MCP endpoint untouched", () => {
    // Direct-to-pod URLs must not be rewritten — AgentGateway is opt-in
    // per server. Touching these would break stdio/in-cluster topologies.
    expect(fix("http://mcp-confluence:8000/mcp", "confluence")).toBe(
      "http://mcp-confluence:8000/mcp",
    );
    expect(fix("https://confluence.example.com/mcp", "confluence")).toBe(
      "https://confluence.example.com/mcp",
    );
  });

  it("can append /mcp to direct upstream origin-only HTTP endpoints", () => {
    expect(
      normalizeMcpEndpointForServer({
        endpoint: "http://mcp-argocd:8000",
        serverId: "mcp-test-argocd",
        agentGatewayBaseUrl: "http://agentgateway:4000",
        directEndpointDefaultPath: "/mcp",
      }),
    ).toBe("http://mcp-argocd:8000/mcp");
  });

  it("does not append /mcp to direct upstream endpoints that already have a path", () => {
    expect(
      normalizeMcpEndpointForServer({
        endpoint: "http://mcp-argocd:8000/custom",
        serverId: "mcp-test-argocd",
        agentGatewayBaseUrl: "http://agentgateway:4000",
        directEndpointDefaultPath: "/mcp",
      }),
    ).toBe("http://mcp-argocd:8000/custom");
  });

  it("leaves undefined / empty endpoints alone (stdio servers)", () => {
    expect(fix(undefined, "confluence")).toBeUndefined();
    expect(fix("", "confluence")).toBe("");
  });

  it("uses the configured agentgateway base, not a hardcoded one", () => {
    // For tenants that override AGENT_GATEWAY_URL, the matcher must
    // follow the override or it will silently fail to repair drift.
    expect(
      fix("https://gw.example.com/mcp", "confluence", "https://gw.example.com"),
    ).toBe("https://gw.example.com/mcp/confluence");
  });

  it("does not touch endpoints when serverId is empty", () => {
    // We refuse to invent a suffix. Failing closed makes a bad call site
    // obvious instead of silently rewriting to an invalid URL.
    expect(fix("http://agentgateway:4000/mcp", "")).toBe(
      "http://agentgateway:4000/mcp",
    );
  });

  it("collapses double slashes in the constructed URL", () => {
    // Be tolerant of user/typo input like `http://agentgateway:4000//mcp/`
    // — normalise rather than reject so legacy data heals on next save.
    expect(fix("http://agentgateway:4000//mcp//", "confluence")).toBe(
      "http://agentgateway:4000/mcp/confluence",
    );
  });
});

describe("isAgentGatewayBaseEndpoint", () => {
  it("returns true for the bare base (with or without /mcp, with or without trailing slash)", () => {
    expect(isAgentGatewayBaseEndpoint("http://agentgateway:4000/mcp", "http://agentgateway:4000")).toBe(true);
    expect(isAgentGatewayBaseEndpoint("http://agentgateway:4000/mcp/", "http://agentgateway:4000")).toBe(true);
    expect(isAgentGatewayBaseEndpoint("http://agentgateway:4000", "http://agentgateway:4000")).toBe(true);
    expect(isAgentGatewayBaseEndpoint("http://agentgateway:4000/", "http://agentgateway:4000")).toBe(true);
  });

  it("returns false for target-qualified endpoints", () => {
    expect(isAgentGatewayBaseEndpoint("http://agentgateway:4000/mcp/confluence", "http://agentgateway:4000")).toBe(false);
    expect(isAgentGatewayBaseEndpoint("http://agentgateway:4000/mcp/jira", "http://agentgateway:4000")).toBe(false);
  });

  it("returns false for direct upstream endpoints", () => {
    expect(isAgentGatewayBaseEndpoint("http://mcp-confluence:8000/mcp", "http://agentgateway:4000")).toBe(false);
  });
});
