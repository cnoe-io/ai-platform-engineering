/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const mockGetAuth = jest.fn();
const mockRequireBaseline = jest.fn();
const mockGetEngineStats = jest.fn();
const mockAuditQuery = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(message: string, public statusCode = 500, public code?: string) {
      super(message);
    }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: (...a: unknown[]) => mockGetAuth(...a),
    withErrorHandler:
      <T,>(h: (...a: unknown[]) => Promise<T>) =>
      async (...a: unknown[]) => {
        try {
          return await h(...a);
        } catch (e) {
          return Response.json(
            { success: false, error: e instanceof Error ? e.message : "error" },
            { status: (e as { statusCode?: number }).statusCode ?? 500 },
          );
        }
      },
  };
});
jest.mock("@/lib/rbac/require-openfga", () => ({
  requireBaselineAdminSurfaceRead: (...a: unknown[]) => mockRequireBaseline(...a),
}));
jest.mock("@/lib/authz", () => ({ getEngineStats: (...a: unknown[]) => mockGetEngineStats(...a) }));
jest.mock("@/lib/audit/reader", () => ({
  getAuditReader: () => ({ query: (...a: unknown[]) => mockAuditQuery(...a) }),
}));

import { GET } from "../admin/authz/stats/route";

function req(qs = ""): NextRequest {
  return new NextRequest(new URL(`/api/admin/authz/stats${qs}`, "http://localhost:3000"));
}

const ENGINE = { circuitState: "closed", cacheSize: 3, cacheHits: 7, cacheMisses: 3, cacheHitRatio: 0.7 };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuth.mockResolvedValue({ session: { org: "acme" } });
  mockRequireBaseline.mockResolvedValue(undefined);
  mockGetEngineStats.mockReturnValue(ENGINE);
  mockAuditQuery.mockResolvedValue([]);
});

it("aggregates decision stats from audit-service and includes the live engine snapshot", async () => {
  mockAuditQuery.mockResolvedValue([
    ...Array.from({ length: 8 }, () => ({ outcome: "allow", reason_code: "OK" })),
    { outcome: "deny", reason_code: "NO_CAPABILITY", resource_ref: "agent:pe" },
    { outcome: "deny", reason_code: "NO_CAPABILITY", resource_ref: "agent:pe" },
  ]);

  const res = await GET(req("?window=24h"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.engine).toEqual(ENGINE);
  expect(body.persistence).toBe(true);
  expect(body.decisions).toMatchObject({
    total: 10,
    allow: 8,
    deny: 2,
    denyRate: 0.2,
    byReason: [{ reason: "OK", count: 8 }, { reason: "NO_CAPABILITY", count: 2 }],
    topDenied: [{ resource: "agent:pe", count: 2 }],
  });
  expect(mockAuditQuery).toHaveBeenCalledWith(expect.objectContaining({ type: "cas_decision", tenantId: "acme" }));
});

it("returns zero decision stats when audit-service has no rows", async () => {
  const res = await GET(req("?window=1h"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({
    engine: ENGINE,
    persistence: true,
    decisions: { total: 0, allow: 0, deny: 0, denyRate: 0, byReason: [], topDenied: [] },
  });
});

it("rejects an invalid window with 400", async () => {
  const res = await GET(req("?window=99y"));
  expect(res.status).toBe(400);
});

it("enforces the metrics admin surface gate", async () => {
  await GET(req("?window=24h"));
  expect(mockRequireBaseline).toHaveBeenCalledWith(expect.anything(), "metrics");
});
