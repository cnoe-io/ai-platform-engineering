/**
 * @jest-environment node
 */

// assisted-by Codex Codex-sonnet-4-6

import { NextRequest } from "next/server";

const mockGetCollection = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

function request(init?: RequestInit): NextRequest {
  return new NextRequest(
    new URL("/api/internal/agentgateway/mcp-targets", "http://localhost:3000"),
    init,
  );
}

describe("internal AgentGateway MCP targets API", () => {
  const previousToken = process.env.AGENTGATEWAY_TARGETS_TOKEN;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.AGENTGATEWAY_TARGETS_TOKEN = "bridge-token";
  });

  afterAll(() => {
    if (previousToken === undefined) {
      delete process.env.AGENTGATEWAY_TARGETS_TOKEN;
    } else {
      process.env.AGENTGATEWAY_TARGETS_TOKEN = previousToken;
    }
  });

  it("returns enabled AgentGateway targets for an internal bridge caller", async () => {
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: "knowledge-base",
            enabled: true,
            source: "agentgateway",
            agentgateway_target_endpoint: "http://rag-server:9446/mcp",
            credential_sources: [
              {
                kind: "caller_token",
                target: "header",
                name: "X-CAIPE-Provider-Token",
              },
            ],
          },
          {
            _id: "manual-target",
            enabled: true,
            source: "manual",
            agentgateway_target_endpoint: "http://manual:8000/mcp",
          },
          {
            _id: "disabled-target",
            enabled: false,
            source: "agentgateway",
            agentgateway_target_endpoint: "http://disabled:8000/mcp",
          },
          {
            _id: "bad target",
            enabled: true,
            source: "agentgateway",
            agentgateway_target_endpoint: "http://bad:8000/mcp",
          },
        ]),
      }),
    });
    const { GET } = await import("../route");

    const response = await GET(
      request({
        headers: { authorization: "Bearer bridge-token" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetCollection).toHaveBeenCalledWith("mcp_servers");
    expect(body).toEqual({
      targets: [
        {
          id: "knowledge-base",
          target_endpoint: "http://rag-server:9446/mcp",
          credential_sources: [
            {
              kind: "caller_token",
              target: "header",
              name: "X-CAIPE-Provider-Token",
            },
          ],
        },
      ],
    });
  });

  it("rejects callers without the bridge token", async () => {
    const { GET } = await import("../route");

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mockGetCollection).not.toHaveBeenCalled();
  });
});
