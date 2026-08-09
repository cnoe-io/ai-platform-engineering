/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockResolveMcpHeaderCredentials = jest.fn();
const mockIsAgentGatewayEndpoint = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: (...args: unknown[]) =>
      mockGetAuthFromBearerOrSession(...args),
    successResponse: (data: unknown, status = 200) =>
      Response.json({ success: true, data }, { status }),
    withErrorHandler:
      <T,>(handler: (request: NextRequest) => Promise<T>) =>
      async (request: NextRequest) => {
        try {
          return await handler(request);
        } catch (error) {
          const typed = error as { status?: number; message: string };
          return Response.json(
            { success: false, error: typed.message },
            { status: typed.status ?? 500 },
          );
        }
      },
  };
});

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

jest.mock("@/lib/mcp-credential-headers", () => ({
  isMcpCredentialUnavailableError: () => false,
  resolveMcpHeaderCredentials: (...args: unknown[]) =>
    mockResolveMcpHeaderCredentials(...args),
}));

jest.mock("@/lib/mcp-http-server-client", () => ({
  isAgentGatewayEndpoint: (...args: unknown[]) => mockIsAgentGatewayEndpoint(...args),
}));

function request(): NextRequest {
  return new NextRequest("http://localhost:3000/api/mcp-servers/credential-probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "http://agentgateway:4000/mcp/example",
      credential_sources: [
        {
          kind: "provider_connection",
          target: "header",
          name: "X-CAIPE-Provider-Token",
          provider: "example",
        },
      ],
    }),
  });
}

describe("POST /api/mcp-servers/credential-probe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      session: { sub: "test-user", accessToken: "caller-token" },
    });
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockIsAgentGatewayEndpoint.mockReturnValue(true);
    mockResolveMcpHeaderCredentials.mockResolvedValue({
      headers: {
        Authorization: "Bearer caller-token",
        "X-CAIPE-Provider-Token": "provider-token",
      },
      sources: [
        {
          name: "X-CAIPE-Provider-Token",
          kind: "provider_connection",
          origin: "provider_connection",
          provider: "example",
        },
      ],
    });
  });

  it("performs a real MCP initialize request through AgentGateway", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      Response.json({
        jsonrpc: "2.0",
        id: "credential-probe-initialize",
        result: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          serverInfo: { name: "example", version: "1.0.0" },
        },
      }),
    ) as unknown as typeof fetch;
    const { POST } = await import("../route");

    const response = await POST(request());
    const body = await response.json();

    expect(body.data).toMatchObject({ ok: true, status: 200, missingCredentials: [] });
    expect(mockResolveMcpHeaderCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ viaAgentGateway: true }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "http://agentgateway:4000/mcp/example",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"method":"initialize"'),
      }),
    );
    const fetchHeaders = (global.fetch as jest.Mock).mock.calls[0][1].headers as Headers;
    expect(fetchHeaders.get("authorization")).toBe("Bearer caller-token");
    expect(fetchHeaders.get("x-caipe-provider-token")).toBe("provider-token");
  });

  it("does not treat an HTTP 405 response as connected", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response("Method Not Allowed", { status: 405 }),
    ) as unknown as typeof fetch;
    const { POST } = await import("../route");

    const response = await POST(request());
    const body = await response.json();

    expect(body.data).toMatchObject({
      ok: false,
      status: 405,
      error: "MCP initialize failed with HTTP 405",
    });
  });

  it("rejects a successful HTTP response without an initialize result", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      Response.json({ jsonrpc: "2.0", id: "credential-probe-initialize" }),
    ) as unknown as typeof fetch;
    const { POST } = await import("../route");

    const response = await POST(request());
    const body = await response.json();

    expect(body.data).toMatchObject({
      ok: false,
      status: 200,
      error: "MCP initialize returned an invalid JSON-RPC response",
    });
  });

  it("does not probe the network when a credential is unresolved", async () => {
    mockResolveMcpHeaderCredentials.mockResolvedValue({
      headers: { Authorization: "Bearer caller-token" },
      sources: [
        {
          name: "X-CAIPE-Provider-Token",
          kind: "provider_connection",
          origin: "none",
          provider: "example",
        },
      ],
    });
    global.fetch = jest.fn() as unknown as typeof fetch;
    const { POST } = await import("../route");

    const response = await POST(request());
    const body = await response.json();

    expect(body.data).toMatchObject({
      ok: false,
      missingCredentials: ["X-CAIPE-Provider-Token"],
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
