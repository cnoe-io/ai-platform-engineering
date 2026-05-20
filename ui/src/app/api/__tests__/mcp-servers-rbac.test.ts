/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetCollection = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockFilterResourcesByPermission = jest.fn();
let mockSession = { sub: "alice-sub", role: "user" };

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public statusCode = 500,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: async () => ({ session: mockSession }),
    getPaginationParams: () => ({ page: 1, pageSize: 20, skip: 0 }),
    paginatedResponse: (items: unknown[], total: number, page: number, pageSize: number) =>
      Response.json({ success: true, data: { items, pagination: { total, page, pageSize } } }),
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    successResponse: (data: unknown, status = 200) => Response.json({ success: true, data }, { status }),
    withErrorHandler:
      <T,>(handler: (...args: unknown[]) => Promise<T>) =>
      async (...args: unknown[]) => {
        try {
          return await handler(...args);
        } catch (error) {
          return Response.json(
            { success: false, error: error instanceof Error ? error.message : "error" },
            { status: (error as { statusCode?: number }).statusCode ?? 500 },
          );
        }
      },
  };
});

jest.mock("@/lib/rbac/resource-authz", () => ({
  filterResourcesByPermission: (...args: unknown[]) => mockFilterResourcesByPermission(...args),
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

function request(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

describe("MCP server per-resource RBAC", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = { sub: "alice-sub", role: "user" };
    mockRequireRbacPermission.mockResolvedValue(undefined);
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockFilterResourcesByPermission.mockImplementation(async (_session, items) =>
      items.filter((item: { _id: string }) => item._id === "mcp-visible"),
    );
  });

  it("filters listed MCP servers through mcp_server#read", async () => {
    const items = [
      { _id: "mcp-visible", name: "Visible" },
      { _id: "mcp-hidden", name: "Hidden" },
    ];
    const limit = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(items) });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    mockGetCollection.mockResolvedValue({
      countDocuments: jest.fn().mockResolvedValue(items.length),
      find: jest.fn().mockReturnValue({ sort }),
    });
    const { GET } = await import("../mcp-servers/route");

    const response = await GET(request("/api/mcp-servers"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
      { sub: "alice-sub", role: "user" },
      items,
      { type: "mcp_server", action: "read", id: expect.any(Function) },
    );
    expect(body.data.items).toEqual([{ _id: "mcp-visible", name: "Visible" }]);
  });

  it("lets admins list legacy MCP servers that lack per-resource tuples", async () => {
    mockSession = { sub: "admin-sub", role: "admin" };
    mockFilterResourcesByPermission.mockImplementation(async (_session, items, _target, options) =>
      options?.allowAdminBypass ? items : [],
    );
    const items = [
      { _id: "jira", name: "Jira", endpoint: "http://mcp-jira:8000/mcp" },
    ];
    const limit = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(items) });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    mockGetCollection.mockResolvedValue({
      countDocuments: jest.fn().mockResolvedValue(items.length),
      find: jest.fn().mockReturnValue({ sort }),
    });
    const { GET } = await import("../mcp-servers/route");

    const response = await GET(request("/api/mcp-servers"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
      { sub: "admin-sub", role: "admin" },
      items,
      { type: "mcp_server", action: "read", id: expect.any(Function) },
      { allowAdminBypass: true },
    );
    expect(body.data.items).toEqual(items);
  });

  it("requires mcp_server#write before updating a server", async () => {
    const server = { _id: "mcp-visible", name: "Visible", config_driven: false };
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(server),
      findOneAndUpdate: jest.fn().mockResolvedValue({ ...server, name: "Updated" }),
    });
    const { PUT } = await import("../mcp-servers/route");

    const response = await PUT(
      request("/api/mcp-servers?id=mcp-visible", {
        method: "PUT",
        body: JSON.stringify({ name: "Updated" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      { sub: "alice-sub", role: "user" },
      { type: "mcp_server", id: "mcp-visible", action: "write" },
    );
  });

  it("lets admins delete legacy MCP servers that lack per-resource tuples", async () => {
    mockSession = { sub: "admin-sub", role: "admin" };
    const server = { _id: "jira", name: "Jira", config_driven: false };
    const deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(server),
      deleteOne,
    });
    const { DELETE } = await import("../mcp-servers/route");

    const response = await DELETE(request("/api/mcp-servers?id=jira", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      { sub: "admin-sub", role: "admin" },
      { type: "mcp_server", id: "jira", action: "delete" },
      { allowAdminBypass: true },
    );
    expect(deleteOne).toHaveBeenCalledWith({ _id: "jira" });
  });
});
