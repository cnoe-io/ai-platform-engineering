/**
 * @jest-environment node
 */

// assisted-by claude code claude-sonnet-4-6

import { NextRequest, NextResponse } from "next/server";

const mockGetServerSession = jest.fn();
const mockRequireRbacPermission = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
}));

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

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
      <T,>(handler: (request: NextRequest, context?: unknown) => Promise<T>) =>
      async (request: NextRequest, context?: unknown) => {
        try {
          return await handler(request, context);
        } catch (err: unknown) {
          if (err instanceof ApiError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
          }
          return NextResponse.json({ error: String(err) }, { status: 500 });
        }
      },
  };
});

const { ApiError } = jest.requireMock("@/lib/api-middleware") as { ApiError: new (m: string, s: number) => Error & { status: number } };

function adminSession() {
  return {
    user: { email: "admin@example.com" },
    accessToken: "tok",
    sub: "sub1",
    org: "org1",
  };
}

function makeRequest(path: string, method = "GET", body?: unknown): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  if (method === "PUT" && body !== undefined) {
    return new NextRequest(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return new NextRequest(url, { method });
}

beforeAll(() => {
  process.env.AUDIT_SERVICE_URL = "http://mock-audit:8010";
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue(adminSession());
  mockRequireRbacPermission.mockResolvedValue(undefined);
});

describe("GET /api/admin/audit-storage", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { GET } = await import("../admin/audit-storage/route");
    const res = await GET(makeRequest("/api/admin/audit-storage"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when permission denied", async () => {
    mockRequireRbacPermission.mockRejectedValue(new ApiError("Forbidden", 403));
    const { GET } = await import("../admin/audit-storage/route");
    const res = await GET(makeRequest("/api/admin/audit-storage"));
    expect(res.status).toBe(403);
  });

  it("returns combined storage/retention/verbosity on success", async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes("/v1/audit/storage")) {
        return new Response(JSON.stringify({ backend: "local", audit_bytes: 1024 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/v1/audit/retention")) {
        return new Response(JSON.stringify({ backend: "local", retention_days: 7, configurable: false }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/v1/audit/verbosity")) {
        return new Response(JSON.stringify({ verbosity: "minimal", allow_all: false, allowed_types: ["cas_grant"] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });

    const { GET } = await import("../admin/audit-storage/route");
    const res = await GET(makeRequest("/api/admin/audit-storage"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.storage).not.toBeNull();
    expect(body.retention).not.toBeNull();
    expect(body.verbosity).not.toBeNull();
    expect(body.errors).toEqual([]);
  });

  it("returns partial result with errors when one upstream call fails", async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes("/v1/audit/storage")) {
        return new Response("service unavailable", { status: 503 });
      }
      if (url.includes("/v1/audit/retention")) {
        return new Response(JSON.stringify({ backend: "local", retention_days: 7, configurable: false }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/v1/audit/verbosity")) {
        return new Response(JSON.stringify({ verbosity: "minimal", allow_all: false }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });

    const { GET } = await import("../admin/audit-storage/route");
    const res = await GET(makeRequest("/api/admin/audit-storage"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.storage).toBeNull();
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toContain("storage: audit-service returned HTTP 503");
    expect(body.retention).not.toBeNull();
    expect(body.verbosity).not.toBeNull();
  });

  it("returns errors for all fields when audit-service is completely down", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const { GET } = await import("../admin/audit-storage/route");
    const res = await GET(makeRequest("/api/admin/audit-storage"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toHaveLength(3);
    expect(body.storage).toBeNull();
    expect(body.retention).toBeNull();
    expect(body.verbosity).toBeNull();
  });
});

describe("PUT /api/admin/audit-storage/retention", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { PUT } = await import("../admin/audit-storage/retention/route");
    const res = await PUT(makeRequest("/api/admin/audit-storage/retention", "PUT", { days: 14 }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when permission denied", async () => {
    mockRequireRbacPermission.mockRejectedValue(new ApiError("Forbidden", 403));
    const { PUT } = await import("../admin/audit-storage/retention/route");
    const res = await PUT(makeRequest("/api/admin/audit-storage/retention", "PUT", { days: 14 }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when body is missing days field", async () => {
    const { PUT } = await import("../admin/audit-storage/retention/route");
    const res = await PUT(makeRequest("/api/admin/audit-storage/retention", "PUT", { not_days: 5 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when days is not a number", async () => {
    const { PUT } = await import("../admin/audit-storage/retention/route");
    const res = await PUT(makeRequest("/api/admin/audit-storage/retention", "PUT", { days: "fourteen" }));
    expect(res.status).toBe(400);
  });

  it("proxies successful retention update", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ backend: "s3", retention_days: 30 }), { status: 200, headers: { "content-type": "application/json" } })
    );
    const { PUT } = await import("../admin/audit-storage/retention/route");
    const res = await PUT(makeRequest("/api/admin/audit-storage/retention", "PUT", { days: 30 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retention_days).toBe(30);
  });

  it("returns upstream error status when audit-service rejects", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "days must be >= 0" }), { status: 400, headers: { "content-type": "application/json" } })
    );
    const { PUT } = await import("../admin/audit-storage/retention/route");
    const res = await PUT(makeRequest("/api/admin/audit-storage/retention", "PUT", { days: -1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("days must be >= 0");
  });

  it("returns 503 when upstream fetch throws", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network error"));
    const { PUT } = await import("../admin/audit-storage/retention/route");
    const res = await PUT(makeRequest("/api/admin/audit-storage/retention", "PUT", { days: 7 }));
    expect(res.status).toBe(503);
  });
});
