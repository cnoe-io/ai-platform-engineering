/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckPermission = jest.fn();
const mockFetch = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(async () => null),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
  getServerOnlyConfig: () => ({ prometheusUrl: "http://prometheus:9090" }),
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "bob-sub",
    email: "bob@example.com",
    name: "Bob Chat User",
  })),
}));

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

function request(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    ...init,
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function expectMetricsDenied(response: Response): Promise<void> {
  const body = await response.json();
  expect(response.status).toBe(403);
  expect(body.reason).toBe("pdp_denied");
  expect(body.code).toBe("admin_surface:metrics#can_manage");
  expect(mockFetch).not.toHaveBeenCalled();
}
beforeEach(() => {
  jest.clearAllMocks();
  mockCheckPermission.mockResolvedValue({ allowed: false, reason: "DENY_NO_CAPABILITY" });
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
  global.fetch = mockFetch;
});

describe("admin metrics route RBAC", () => {
  it("allows Metrics administrators to proxy an instant PromQL query", async () => {
    const { GET } = await import("../route");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "success",
        data: { resultType: "vector", result: [] },
      }),
    });

    const response = await GET(
      request("/api/admin/metrics?query=up", {
        method: "GET",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledWith({
      user: "user:bob-sub",
      relation: "can_manage",
      object: "admin_surface:metrics",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://prometheus:9090/api/v1/query?query=up",
      expect.objectContaining({ headers: { Accept: "application/json" } })
    );
  });

  it("allows Metrics administrators to proxy batch PromQL queries", async () => {
    const { POST } = await import("../route");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "success",
        data: { resultType: "vector", result: [] },
      }),
    });

    const response = await POST(
      request("/api/admin/metrics", {
        method: "POST",
        body: JSON.stringify({ queries: [{ id: "up", query: "up" }] }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.up).toEqual({
      status: "success",
      data: { resultType: "vector", result: [] },
    });
  });

  it("rejects a baseline reader without Metrics administration access", async () => {
    const { GET } = await import("../route");
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });

    const response = await GET(
      request("/api/admin/metrics?query=up", {
        method: "GET",
      })
    );

    await expectMetricsDenied(response);
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledWith({
      user: "user:bob-sub",
      relation: "can_manage",
      object: "admin_surface:metrics",
    });
  });
});
