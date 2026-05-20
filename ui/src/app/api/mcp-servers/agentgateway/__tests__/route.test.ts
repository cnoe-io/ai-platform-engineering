/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockGetCollection = jest.fn();

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
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    successResponse: (data: unknown, status = 200) => Response.json({ success: true, data }, { status }),
    withErrorHandler:
      <T,>(handler: (request: NextRequest) => Promise<T>) =>
      (request: NextRequest) =>
        handler(request),
  };
});

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

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

function request(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuthFromBearerOrSession.mockResolvedValue({ session: { sub: "admin-sub", role: "admin" } });
  mockRequireRbacPermission.mockResolvedValue(undefined);
  mockRequireResourcePermission.mockResolvedValue(undefined);
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => agentGatewayConfig,
  }) as unknown as typeof fetch;
});

describe("AgentGateway MCP server discovery API", () => {
  it("discovers AgentGateway MCP targets and marks direct registrations as conflicts", async () => {
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: "jira",
            name: "Jira",
            transport: "http",
            endpoint: "http://mcp-jira:8000/mcp",
            enabled: true,
          },
        ]),
      }),
    });
    const { GET } = await import("../discover/route");

    const response = await GET(request("/api/mcp-servers/agentgateway/discover"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireRbacPermission).toHaveBeenCalledWith(
      { sub: "admin-sub", role: "admin" },
      "mcp_server",
      "view",
    );
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      { sub: "admin-sub", role: "admin" },
      { type: "mcp_server", id: "agentgateway", action: "discover" },
      { allowAdminBypass: true },
    );
    expect(body.data.targets).toEqual([
      expect.objectContaining({ id: "rag", status: "new" }),
      expect.objectContaining({
        id: "jira",
        endpoint: "http://agentgateway:4000/mcp",
        target_endpoint: "http://mcp-jira:8000/mcp",
        status: "conflict",
        existing_endpoint: "http://mcp-jira:8000/mcp",
      }),
    ]);
  });

  it("auto-imports all new AgentGateway MCP targets and reports legacy conflicts", async () => {
    const insertOne = jest.fn();
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: "jira",
            name: "Jira",
            transport: "http",
            endpoint: "http://mcp-jira:8000/mcp",
            enabled: true,
          },
        ]),
      }),
      insertOne,
    });
    const { POST } = await import("../sync/route");

    const response = await POST(
      request("/api/mcp-servers/agentgateway/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      { sub: "admin-sub", role: "admin" },
      { type: "mcp_server", id: "agentgateway", action: "admin" },
      { allowAdminBypass: true },
    );
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "rag",
        name: "RAG",
        transport: "http",
        endpoint: "http://agentgateway:4000/mcp",
        enabled: true,
        source: "agentgateway",
        agentgateway_discovered: true,
        agentgateway_target_endpoint: "http://rag-server:9446/mcp",
      }),
    );
    expect(body.data).toMatchObject({
      added: ["rag"],
      skipped: [{ id: "jira", reason: "conflict" }],
      summary: {
        added: 1,
        existing: 0,
        conflicts: 1,
        skipped: 1,
      },
      conflicts: [
        expect.objectContaining({
          id: "jira",
          endpoint: "http://agentgateway:4000/mcp",
          existing_endpoint: "http://mcp-jira:8000/mcp",
        }),
      ],
      migration_warnings: [
        expect.objectContaining({
          id: "jira",
          message: expect.stringMatching(/legacy MCP server conflicts with AgentGateway/i),
        }),
      ],
    });
  });

  it("allows admin discovery to bypass missing AgentGateway object grant", async () => {
    mockRequireResourcePermission.mockImplementation((_session, _resource, options) => {
      if (options?.allowAdminBypass) return Promise.resolve();
      return Promise.reject(new Error("no discovery"));
    });
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    const { GET } = await import("../discover/route");

    const response = await GET(request("/api/mcp-servers/agentgateway/discover"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.targets).toEqual([
      expect.objectContaining({ id: "rag", status: "new" }),
      expect.objectContaining({ id: "jira", status: "new" }),
    ]);
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      { sub: "admin-sub", role: "admin" },
      { type: "mcp_server", id: "agentgateway", action: "discover" },
      { allowAdminBypass: true },
    );
  });

  it("allows admin sync to bypass missing AgentGateway object grant", async () => {
    const insertOne = jest.fn();
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      insertOne,
    });
    mockRequireResourcePermission.mockImplementation((_session, _resource, options) => {
      if (options?.allowAdminBypass) return Promise.resolve();
      return Promise.reject(new Error("no manage"));
    });
    const { POST } = await import("../sync/route");

    const response = await POST(
      request("/api/mcp-servers/agentgateway/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(insertOne).toHaveBeenCalledTimes(2);
    expect(body.data.summary).toMatchObject({ added: 2, conflicts: 0 });
  });

  it("validates selected target ids after the manage gate when ids are provided", async () => {
    const { POST } = await import("../sync/route");

    await expect(
      POST(
        request("/api/mcp-servers/agentgateway/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: ["rag", 123] }),
        }),
      ),
    ).rejects.toThrow("ids must be an array");

    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      { sub: "admin-sub", role: "admin" },
      { type: "mcp_server", id: "agentgateway", action: "admin" },
      { allowAdminBypass: true },
    );
  });
});
