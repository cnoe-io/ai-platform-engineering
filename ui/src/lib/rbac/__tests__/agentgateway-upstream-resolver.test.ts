/**
 * @jest-environment node
 */

import {
  agentGatewayTargetIdFromEndpoint,
  directUpstreamEndpoint,
  isAgentGatewayManagedEndpoint,
} from "../agentgateway-upstream-resolver";

describe("agentgateway-upstream-resolver", () => {
  beforeEach(() => {
    process.env.AGENT_GATEWAY_URL = "http://agentgateway:4000";
  });

  afterEach(() => {
    delete process.env.AGENT_GATEWAY_URL;
  });

  it("detects AgentGateway-managed endpoints", () => {
    expect(isAgentGatewayManagedEndpoint("http://agentgateway:4000/mcp")).toBe(true);
    expect(isAgentGatewayManagedEndpoint("http://agentgateway:4000/mcp/jira")).toBe(true);
    expect(isAgentGatewayManagedEndpoint("http://mcp-jira:8000/mcp")).toBe(false);
  });

  it("extracts the target id suffix from an AgentGateway endpoint", () => {
    expect(agentGatewayTargetIdFromEndpoint("http://agentgateway:4000/mcp/jira")).toBe("jira");
    expect(agentGatewayTargetIdFromEndpoint("http://agentgateway:4000/mcp/mcp-jira-gu")).toBe(
      "mcp-jira-gu",
    );
  });

  it("returns direct upstream URLs and rejects gateway routes", () => {
    expect(directUpstreamEndpoint("http://mcp-jira:8000/mcp")).toBe("http://mcp-jira:8000/mcp");
    expect(directUpstreamEndpoint("http://agentgateway:4000/mcp/jira")).toBeUndefined();
  });
});
