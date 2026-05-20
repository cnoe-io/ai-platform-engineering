/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetCollection = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockFilterResourcesByPermission = jest.fn();

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
    getAuthFromBearerOrSession: async () => ({ session: { sub: "alice-sub", role: "user" } }),
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
});
