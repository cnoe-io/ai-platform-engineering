/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockWithOpenFgaViewAuth = jest.fn(
  async (_request: NextRequest, handler: (auth: unknown) => Promise<unknown>) =>
    handler({
      user: { email: "alice@example.com" },
      session: { accessToken: "rag-admin-token", sub: "alice-sub", org: "platform" },
    }),
);
const mockListRebacCatalog = jest.fn();

const mockCollections: Record<string, unknown[]> = {};

jest.mock("../_lib", () => ({
  withOpenFgaViewAuth: (...args: unknown[]) => mockWithOpenFgaViewAuth(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) => createMockCollection(mockCollections[name] ?? [])),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  isOpenFgaConfigured: () => true,
  isOpenFgaReconciliationEnabled: () => true,
}));

jest.mock("@/lib/rbac/resource-catalog", () => ({
  listRebacCatalog: (...args: unknown[]) => mockListRebacCatalog(...args),
}));

function createMockCollection(rows: unknown[]) {
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(rows) }),
      }),
      limit: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(rows) }),
      toArray: jest.fn().mockResolvedValue(rows),
    }),
  };
}

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockCollections.teams = [{ _id: "team-1", slug: "platform", name: "Platform" }];
  mockCollections.dynamic_agents = [];
  mockCollections.mcp_servers = [];
  mockListRebacCatalog.mockResolvedValue({ resource_types: [], actions: {}, resources: [] });
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      datasources: [
        {
          datasource_id: "src_https___cnoe_io_github_io_ai_platform_engineering__e392d7ef8e8b",
          name: "cnoe.io / github.io",
          description: "Canonical datasource label",
        },
        {
          datasource_id: "src_https___example_com_docs__abc123",
          name: "example.com docs",
          description: "Unassigned datasource",
        },
      ],
    }),
  })) as unknown as typeof fetch;
});

describe("GET /api/admin/openfga/catalog", () => {
  it("uses the canonical RAG datasource name for knowledge-base resources", async () => {
    const { GET } = await import("../catalog/route");

    const response = await GET(request("/api/admin/openfga/catalog"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.resources.knowledge_bases).toEqual([
      {
        id: "src_https___cnoe_io_github_io_ai_platform_engineering__e392d7ef8e8b",
        name: "cnoe.io / github.io",
        description: "Canonical datasource label",
        object: "knowledge_base:src_https___cnoe_io_github_io_ai_platform_engineering__e392d7ef8e8b",
      },
      {
        id: "src_https___example_com_docs__abc123",
        name: "example.com docs",
        description: "Unassigned datasource",
        object: "knowledge_base:src_https___example_com_docs__abc123",
      },
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:9446/v1/datasources",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer rag-admin-token" }),
      }),
    );
  });
});
