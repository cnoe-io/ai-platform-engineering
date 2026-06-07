/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockRequireRbac = jest.fn();
const mockAuthorize = jest.fn();
const mockGrant = jest.fn();
const mockRevoke = jest.fn();

jest.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => mockGetServerSession(...a) }));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));
jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(message: string, public statusCode = 500, public code?: string) {
      super(message);
    }
  }
  return {
    ApiError,
    requireRbacPermission: (...a: unknown[]) => mockRequireRbac(...a),
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
// requireManage (real, from http.ts) uses authorize from @/lib/authz → mock it.
jest.mock("@/lib/authz", () => ({
  authorize: (...a: unknown[]) => mockAuthorize(...a),
  grant: (...a: unknown[]) => mockGrant(...a),
  revoke: (...a: unknown[]) => mockRevoke(...a),
}));

import { POST, DELETE } from "../admin/authz/grants/route";

function body(b: unknown, method = "POST"): NextRequest {
  return new NextRequest(new URL("/api/admin/authz/grants", "http://localhost:3000"), { method, body: JSON.stringify(b) });
}
const validGrant = { resource: { type: "agent", id: "pe" }, grantee: { type: "team", id: "eng" }, capability: "use" };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: "admin@acme.com" }, sub: "admin", org: "acme" });
  mockRequireRbac.mockResolvedValue(undefined);
  mockAuthorize.mockResolvedValue({ decision: "ALLOW", reason: "OK" }); // caller can manage
});

it("grants when the caller can manage the resource", async () => {
  const res = await POST(body(validGrant));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ granted: true });
  expect(mockGrant).toHaveBeenCalledWith(
    { resource: { type: "agent", id: "pe" }, grantee: { type: "team", id: "eng" }, capability: "use" },
    expect.anything(),
  );
});

it("revokes on DELETE", async () => {
  const res = await DELETE(body(validGrant, "DELETE"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ revoked: true });
  expect(mockRevoke).toHaveBeenCalled();
});

it("returns 403 (meta-authz) when the caller cannot manage the resource", async () => {
  mockAuthorize.mockResolvedValue({ decision: "DENY", reason: "NO_CAPABILITY" });
  const res = await POST(body(validGrant));
  expect(res.status).toBe(403);
  expect(mockGrant).not.toHaveBeenCalled();
});

it("returns 400 for an invalid grant body", async () => {
  const res = await POST(body({ resource: { type: "agent", id: "pe" }, grantee: { type: "team", id: "eng" }, capability: "frobnicate" }));
  expect(res.status).toBe(400);
  expect(mockGrant).not.toHaveBeenCalled();
});

it("returns 401 without a session", async () => {
  mockGetServerSession.mockResolvedValue(null);
  const res = await POST(body(validGrant));
  expect(res.status).toBe(401);
});

it("enforces the admin gate", async () => {
  await POST(body(validGrant));
  expect(mockRequireRbac).toHaveBeenCalledWith(expect.anything(), "admin_ui", "audit.view");
});
