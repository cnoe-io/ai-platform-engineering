/**
 * @jest-environment node
 *
 * Tests for GET /api/admin/identity-group-sync/directory-sync/runs — the
 * paginated Sync History endpoint. Mocks the store so we assert param parsing
 * (page / page_size clamping), provider passthrough, and the
 * `{ runs, total, page, page_size, has_more }` envelope without a real Mongo.
 */

import { NextRequest } from "next/server";

const mockListIdpSyncRunsPage = jest.fn();
const mockReapStaleIdpSyncRuns = jest.fn();
const mockResolveProviderParam = jest.fn();

let mockIsMongoDBConfigured = true;

jest.mock("@/lib/mongodb", () => ({
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
}));

// The view-auth wrapper is exercised by its own surface; here we just let the
// handler run so we can assert the route's pagination behavior.
jest.mock("../../../_lib", () => ({
  withIdentityGroupSyncViewAuth: (_req: unknown, handler: () => Promise<unknown>) => handler(),
}));

jest.mock("../../_provider", () => ({
  resolveProviderParam: (...args: unknown[]) => mockResolveProviderParam(...args),
}));

jest.mock("@/lib/rbac/idp-sync-store", () => ({
  listIdpSyncRunsPage: (...args: unknown[]) => mockListIdpSyncRunsPage(...args),
  reapStaleIdpSyncRuns: (...args: unknown[]) => mockReapStaleIdpSyncRuns(...args),
}));

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"));
}

async function callGet(url: string) {
  const { GET } = await import("../route");
  const response = await GET(makeRequest(url));
  return { response, body: await response.json() };
}

const BASE = "/api/admin/identity-group-sync/directory-sync/runs";

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMongoDBConfigured = true;
  mockResolveProviderParam.mockReturnValue("okta");
  mockReapStaleIdpSyncRuns.mockResolvedValue(0);
  mockListIdpSyncRunsPage.mockResolvedValue({ runs: [{ id: "r1" }], total: 42 });
});

describe("GET .../directory-sync/runs", () => {
  it("returns a paginated envelope and passes page/size + provider to the store", async () => {
    const { response, body } = await callGet(`${BASE}?provider=okta&page=2&page_size=10`);

    expect(response.status).toBe(200);
    expect(body.data.runs).toEqual([{ id: "r1" }]);
    expect(body.data.total).toBe(42);
    expect(body.data.page).toBe(2);
    expect(body.data.page_size).toBe(10);
    // 2 * 10 = 20 < 42 → another page exists.
    expect(body.data.has_more).toBe(true);
    expect(body.data.provider).toBe("okta");

    expect(mockListIdpSyncRunsPage).toHaveBeenCalledWith("okta", { page: 2, pageSize: 10 });
  });

  it("defaults to page 1, size 20 when params are absent", async () => {
    await callGet(`${BASE}?provider=okta`);
    expect(mockListIdpSyncRunsPage).toHaveBeenCalledWith("okta", { page: 1, pageSize: 20 });
  });

  it("clamps page_size to the 1..100 range", async () => {
    await callGet(`${BASE}?provider=okta&page_size=9999`);
    expect(mockListIdpSyncRunsPage).toHaveBeenCalledWith(
      "okta",
      expect.objectContaining({ pageSize: 100 }),
    );
  });

  it("is provider-scoped — passes whatever connector resolves (e.g. a future one)", async () => {
    mockResolveProviderParam.mockReturnValue("duo");
    const { body } = await callGet(`${BASE}?provider=duo`);

    expect(body.data.provider).toBe("duo");
    expect(mockListIdpSyncRunsPage).toHaveBeenCalledWith("duo", expect.any(Object));
  });

  it("reaps stale running rows before reading", async () => {
    await callGet(`${BASE}?provider=okta`);
    expect(mockReapStaleIdpSyncRuns).toHaveBeenCalledWith("okta", expect.any(Number));
  });

  it("503s when MongoDB is not configured", async () => {
    mockIsMongoDBConfigured = false;
    const { response, body } = await callGet(`${BASE}?provider=okta`);

    expect(response.status).toBe(503);
    expect(body.code).toBe("MONGODB_NOT_CONFIGURED");
    expect(mockListIdpSyncRunsPage).not.toHaveBeenCalled();
  });
});
