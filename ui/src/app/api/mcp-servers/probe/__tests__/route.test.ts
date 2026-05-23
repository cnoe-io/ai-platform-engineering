/**
 * @jest-environment node
 *
 * Probe button regression suite.
 *
 * The Create Agent → Tools step Probe button hits this BFF route to list
 * the tools advertised by a configured MCP server. Earlier revisions gated
 * it on OpenFGA ``mcp_server:<id>#can_invoke``, but invocation rights are a
 * strict superset of "can I see what tools exist" — and team members who
 * have a server *shared* with them (read/use, not invoke) were getting
 * 403s on the Probe button despite legitimately needing to render the
 * picker.
 *
 * The new contract:
 *   Probing requires ``mcp_server:<id>#can_discover``. The authorization
 *   model already grants ``can_discover`` to ``organization#member`` and
 *   to anyone the server is shared with via team/channel/group tuples,
 *   while ``organization#admin`` keeps the override via ``can_manage``.
 *   Runtime tool invocation continues to enforce ``can_invoke`` on the
 *   agent execution path; this route only enumerates tool metadata.
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockGetCollection = jest.fn();
const mockAuthenticateRequest = jest.fn();
const mockBuildBackendHeaders = jest.fn();

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
        } catch (err) {
          const e = err as { status?: number; message: string };
          return Response.json(
            { success: false, error: e.message },
            { status: e.status ?? 500 },
          );
        }
      },
  };
});

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) =>
    mockRequireResourcePermission(...args),
}));

jest.mock("@/lib/da-proxy", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
  buildBackendHeaders: (...args: unknown[]) => mockBuildBackendHeaders(...args),
}));

function request(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

const session = { sub: "bob-sub", role: "user" };

describe("POST /api/mcp-servers/probe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ session });
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({
        _id: "argocd",
        name: "Argocd",
        enabled: true,
      }),
    });
    mockAuthenticateRequest.mockResolvedValue({
      subject: "bob-sub",
      email: "bob@example.com",
      role: "user",
      bearerToken: "token",
    });
    mockBuildBackendHeaders.mockReturnValue({
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, tools: [{ name: "ls", description: "list" }] }),
    }) as unknown as typeof fetch;
  });

  it("gates probe with mcp_server#can_discover (not can_invoke) so team-shared and org-member users can render tool lists", async () => {
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/mcp-servers/probe?id=argocd", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    // The new contract: probing requires discover, not invoke.
    expect(mockRequireResourcePermission).toHaveBeenCalledTimes(1);
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(session, {
      type: "mcp_server",
      id: "argocd",
      action: "discover",
    });
    // Sanity: we never sneak in an extra can_invoke check on the probe path.
    for (const call of mockRequireResourcePermission.mock.calls) {
      expect(call[1]).not.toMatchObject({ action: "invoke" });
    }
  });

  it("returns 403 when OpenFGA denies can_discover on the server", async () => {
    mockRequireResourcePermission.mockRejectedValueOnce(
      Object.assign(new Error("not allowed"), {
        status: 403,
        statusCode: 403,
        code: "mcp_server#discover",
      }),
    );
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/mcp-servers/probe?id=argocd", { method: "POST" }),
    );

    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
