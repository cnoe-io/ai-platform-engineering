/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const mockGetAuth = jest.fn();
const mockRequireBaseline = jest.fn();
const mockGetEngineStats = jest.fn();
const mockGetCollection = jest.fn();
let mongoConfigured = true;

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
jest.mock("@/lib/mongodb", () => ({
  getCollection: (...a: unknown[]) => mockGetCollection(...a),
  get isMongoDBConfigured() {
    return mongoConfigured;
  },
}));

import { GET } from "../admin/authz/stats/route";

function req(qs = ""): NextRequest {
  return new NextRequest(new URL(`/api/admin/authz/stats${qs}`, "http://localhost:3000"));
}

const ENGINE = { circuitState: "closed", cacheSize: 3, cacheHits: 7, cacheMisses: 3, cacheHitRatio: 0.7 };

beforeEach(() => {
  jest.clearAllMocks();
  mongoConfigured = true;
  mockGetAuth.mockResolvedValue({ session: { org: "acme" } });
  mockRequireBaseline.mockResolvedValue(undefined);
  mockGetEngineStats.mockReturnValue(ENGINE);
});

it("aggregates decision stats from audit_events and includes the live engine snapshot", async () => {
  const aggregate = jest.fn((pipeline: unknown[]) => {
    const grp = (pipeline[1] as { $group: { _id: string } }).$group._id;
    const rows = grp === "$reason_code"
      ? [{ _id: "OK", count: 8 }, { _id: "NO_CAPABILITY", count: 2 }]
      : [{ _id: "agent:pe", count: 2 }];
    return { toArray: async () => rows };
  });
  const countDocuments = jest
    .fn()
    .mockResolvedValueOnce(10) // total
    .mockResolvedValueOnce(8) // allow
    .mockResolvedValueOnce(2); // deny
  mockGetCollection.mockResolvedValue({ countDocuments, aggregate });

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
  // tenant scoping applied
  expect(countDocuments.mock.calls[0][0]).toMatchObject({ type: "cas_decision", tenant_id: "acme" });
});

it("returns engine-only stats with persistence:false when Mongo is unconfigured", async () => {
  mongoConfigured = false;
  const res = await GET(req("?window=1h"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ engine: ENGINE, decisions: null, persistence: false });
  expect(mockGetCollection).not.toHaveBeenCalled();
});

it("rejects an invalid window with 400", async () => {
  const res = await GET(req("?window=99y"));
  expect(res.status).toBe(400);
});

it("enforces the metrics admin surface gate", async () => {
  await GET(req("?window=24h"));
  expect(mockRequireBaseline).toHaveBeenCalledWith(expect.anything(), "metrics");
});
