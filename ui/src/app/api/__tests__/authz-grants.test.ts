/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

// assisted-by Codex Codex-sonnet-4-6

const mockGetServerSession = jest.fn();
const mockAuthorize = jest.fn();
const mockGrant = jest.fn();
const mockRevoke = jest.fn();
const mockEmitGrantAudit = jest.fn();

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
jest.mock("@/lib/authz/audit", () => ({
  emitGrantAudit: (...a: unknown[]) => mockEmitGrantAudit(...a),
}));

import { POST, DELETE } from "../admin/authz/grants/route";

function body(b: unknown, method = "POST"): NextRequest {
  return new NextRequest(new URL("/api/admin/authz/grants", "http://localhost:3000"), { method, body: JSON.stringify(b) });
}
const validGrant = { resource: { type: "agent", id: "pe" }, grantee: { type: "team", id: "eng" }, capability: "use" };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: "admin@acme.com" }, sub: "admin", org: "acme" });
  mockAuthorize.mockResolvedValue({ decision: "ALLOW", reason: "OK" }); // caller can manage
});

it("grants when the caller can manage the resource", async () => {
  const res = await POST(body(validGrant));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ granted: true });
  expect(mockGrant).toHaveBeenCalledWith(
    { resource: { type: "agent", id: "pe" }, grantee: { type: "team", id: "eng" }, capability: "use" },
    expect.objectContaining({
      tenantId: "acme",
      caller: { type: "user", id: "admin" },
      correlationId: expect.any(String),
    }),
  );
  expect(mockEmitGrantAudit).not.toHaveBeenCalled();
});

it("grants when the caller is an organization admin without direct resource manage", async () => {
  mockAuthorize
    .mockResolvedValueOnce({ decision: "DENY", reason: "NO_CAPABILITY", retriable: false })
    .mockResolvedValueOnce({ decision: "ALLOW", reason: "OK", retriable: false, via: "org_admin" });

  const res = await POST(body(validGrant));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ granted: true });
  expect(mockAuthorize).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ resource: { type: "agent", id: "pe" }, action: "manage" }),
    expect.objectContaining({ tenantId: "acme" }),
  );
  expect(mockAuthorize).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ resource: { type: "organization", id: "caipe" }, action: "manage" }),
    expect.objectContaining({ tenantId: "acme" }),
  );
  expect(mockGrant).toHaveBeenCalled();
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
  expect(mockEmitGrantAudit).toHaveBeenCalledWith(
    "grant",
    { resource: { type: "agent", id: "pe" }, grantee: { type: "team", id: "eng" }, capability: "use" },
    expect.objectContaining({ caller: { type: "user", id: "admin" }, tenantId: "acme" }),
    { outcome: "error", reasonCode: "NO_CAPABILITY" },
  );
});

it("threads x-correlation-id into grant context", async () => {
  const res = await POST(
    new NextRequest(new URL("/api/admin/authz/grants", "http://localhost:3000"), {
      method: "POST",
      headers: { "x-correlation-id": "corr-admin-grant" },
      body: JSON.stringify(validGrant),
    }),
  );
  expect(res.status).toBe(200);
  expect(mockGrant).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ correlationId: "corr-admin-grant" }),
  );
});

it("returns 400 for an invalid grant body", async () => {
  const res = await POST(body({ resource: { type: "agent", id: "pe" }, grantee: { type: "team", id: "eng" }, capability: "frobnicate" }));
  expect(res.status).toBe(400);
  expect(mockGrant).not.toHaveBeenCalled();
});

it("returns 400 when the capability is unsupported by the resource type", async () => {
  const res = await POST(body({ resource: { type: "agent", id: "pe" }, grantee: { type: "team", id: "eng" }, capability: "ingest" }));
  expect(res.status).toBe(400);
  expect(mockGrant).not.toHaveBeenCalled();
});

it("returns 400 for high-risk everyone grants", async () => {
  const res = await POST(body({ resource: { type: "agent", id: "pe" }, grantee: { type: "everyone" }, capability: "manage" }));
  expect(res.status).toBe(400);
  expect(mockGrant).not.toHaveBeenCalled();
});

it("returns 401 without a session", async () => {
  mockGetServerSession.mockResolvedValue(null);
  const res = await POST(body(validGrant));
  expect(res.status).toBe(401);
});

it("does not require admin_ui/audit.view — resource managers may grant", async () => {
  const res = await POST(body(validGrant));
  // Succeeds purely on can_manage (no admin gate)
  expect(res.status).toBe(200);
});
