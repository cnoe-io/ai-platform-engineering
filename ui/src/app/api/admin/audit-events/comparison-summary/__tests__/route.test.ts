/** @jest-environment node */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockRequireRbacPermission = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));

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
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    withErrorHandler:
      <T,>(handler: (request: NextRequest) => Promise<T>) =>
      (request: NextRequest) => handler(request),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({
    accessToken: "token",
    sub: "admin-sub",
    org: "example",
    user: { email: "admin@example.com" },
  });
  mockRequireRbacPermission.mockResolvedValue(undefined);
  global.fetch = jest.fn(async () => new Response(JSON.stringify({
    records: Array.from({ length: 100 }, (_, index) => ({
      ts: `2026-08-18T00:00:${String(index % 60).padStart(2, "0")}Z`,
      type: "authz_migration_comparison",
      tenant_id: "example",
      subject_hash: "not-applicable",
      action: "invoke",
      outcome: "success",
      correlation_id: `correlation-${index}`,
      source: "bff",
      rollout_revision: "revision-1",
      authoritative_path: "LEGACY",
      mismatch_class: "NONE",
      authz_duration_ms: 10,
    })),
    total: 100,
    truncated: false,
  }), { status: 200 }));
});

it("returns bounded promotion evidence and forwards comparison filters", async () => {
  const { GET } = await import("../route");
  const request = new NextRequest(
    "http://localhost/api/admin/audit-events/comparison-summary?window=1h&authoritative_path=LEGACY&rollout_revision=revision-1",
  );

  const response = await GET(request);
  const body = await response.json();

  expect(body.evidence_ready).toBe(true);
  expect(body.comparison_count).toBe(100);
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("authoritative_path=LEGACY"),
    expect.objectContaining({ cache: "no-store" }),
  );
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("tenant_id=example"),
    expect.objectContaining({ cache: "no-store" }),
  );
});
