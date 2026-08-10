/**
 * @jest-environment node
 */

// assisted-by Codex Codex-sonnet-4-6

import { NextRequest,NextResponse } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockRunRbacSelfCheckTests = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 500) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    ApiError,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    successResponse: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    withErrorHandler:
      (handler: (request: NextRequest) => Promise<Response>) =>
      async (request: NextRequest) => {
        try {
          return await handler(request);
        } catch (error) {
          return NextResponse.json(
            {
              success: false,
              error: error instanceof Error ? error.message : "error",
            },
            {
              status:
                error && typeof error === "object" && "statusCode" in error
                  ? Number(error.statusCode)
                  : 500,
            },
          );
        }
      },
  };
});

jest.mock("@/lib/rbac/self-check-tests", () => ({
  RBAC_SELF_CHECK_TEST_SUITES: [
    { id: "credentials", label: "Credentials", description: "Credential checks", default_enabled: true },
    { id: "chat_sre_agent", label: "Chat with SRE Agent", description: "SRE checks", default_enabled: false },
  ],
  runRbacSelfCheckTests: (...args: unknown[]) => mockRunRbacSelfCheckTests(...args),
}));

function request(body?: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL("/api/admin/rebac/self-check/tests", "http://localhost:3000"), {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuthFromBearerOrSession.mockResolvedValue({
    session: { sub: "admin-sub", user: { email: "admin@example.com" } },
  });
  mockRequireRbacPermission.mockResolvedValue(undefined);
  mockRunRbacSelfCheckTests.mockResolvedValue({
    generated_at: "2026-06-28T00:00:00.000Z",
    status: "pass",
    summary: { suites: 1, cases: 1, checks: 1, passed: 1, failed: 0, blocked: 0, skipped: 0, duration_ms: 1 },
    actors: [],
    suites: [],
    self_check_status: "pass",
    notes: [],
  });
});

it("returns the test catalog", async () => {
  const { GET } = await import("../route");

  const response = await GET(request());
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(mockRequireRbacPermission).toHaveBeenCalledWith(expect.any(Object), "admin_ui", "view");
  expect(body.data.default_suites).toEqual(["credentials"]);
  expect(body.data.suites).toHaveLength(2);
});

it("runs selected suites and custom assertions with the caller as org admin", async () => {
  const { POST } = await import("../route");

  const response = await POST(request({
    suites: ["credentials", "service_accounts"],
    actors: { member_user: "member-sub" },
    assertions: [
      {
        id: "credential-private-deny",
        actor: { type: "user", id: "member-sub" },
        resource: { type: "secret_ref", id: "secret-private" },
        action: "read-metadata",
        expect: "DENY",
      },
    ],
  }));

  expect(response.status).toBe(200);
  expect(mockRequireRbacPermission).toHaveBeenCalledWith(expect.any(Object), "admin_ui", "admin");
  expect(mockRunRbacSelfCheckTests).toHaveBeenCalledWith({
    suites: ["credentials", "service_accounts"],
    actors: { member_user: "member-sub" },
    assertions: [
      {
        id: "credential-private-deny",
        title: undefined,
        actor: { type: "user", id: "member-sub", label: undefined },
        resource: { type: "secret_ref", id: "secret-private", label: undefined },
        action: "read-metadata",
        expect: "DENY",
      },
    ],
    callerSubject: { type: "user", id: "admin-sub" },
  });
});

it("rejects malformed assertions", async () => {
  const { POST } = await import("../route");

  const response = await POST(request({ assertions: [{ actor: { type: "user", id: "member-sub" } }] }));
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error).toMatch(/resource is required/);
  expect(mockRunRbacSelfCheckTests).not.toHaveBeenCalled();
});
