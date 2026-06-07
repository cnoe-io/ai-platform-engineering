/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockRequireRbac = jest.fn();
const mockAuthorize = jest.fn();
const mockDescribe = jest.fn();

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
jest.mock("@/lib/authz", () => ({
  authorize: (...a: unknown[]) => mockAuthorize(...a),
  describeFgaCheck: (...a: unknown[]) => mockDescribe(...a),
}));

import { POST } from "../admin/authz/explain/route";

function post(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/admin/authz/explain", "http://localhost:3000"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validBody = {
  subject: { type: "user", id: "bob" },
  resource: { type: "agent", id: "pe" },
  action: "use",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: "admin@acme.com" }, sub: "admin", org: "acme" });
  mockRequireRbac.mockResolvedValue(undefined);
});

it("returns the decision plus the OpenFGA debug block for an admin", async () => {
  mockAuthorize.mockResolvedValue({ decision: "DENY", reason: "NO_CAPABILITY", retriable: false });
  mockDescribe.mockReturnValue({ engine: "openfga", relation: "can_use", user: "user:bob", object: "agent:pe", store: "store-xyz" });
  const res = await POST(post(validBody));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    decision: "DENY",
    reason: "NO_CAPABILITY",
    debug: { engine: "openfga", relation: "can_use", checked: ["user:bob can_use agent:pe"], store: "store-xyz" },
  });
  expect(mockRequireRbac).toHaveBeenCalledWith(expect.anything(), "admin_ui", "audit.view");
});

it("returns 401 when there is no session", async () => {
  mockGetServerSession.mockResolvedValue(null);
  const res = await POST(post(validBody));
  expect(res.status).toBe(401);
  expect(mockAuthorize).not.toHaveBeenCalled();
});

it("returns 400 for an invalid subject (validation via shared parsers)", async () => {
  const res = await POST(post({ ...validBody, subject: { type: "user", id: "agent:*" } }));
  expect(res.status).toBe(400);
  expect(mockAuthorize).not.toHaveBeenCalled();
});

it("returns 400 for an unrecognized action", async () => {
  const res = await POST(post({ ...validBody, action: "frobnicate" }));
  expect(res.status).toBe(400);
});

it("returns 400 on malformed JSON", async () => {
  const r = new NextRequest(new URL("/api/admin/authz/explain", "http://localhost:3000"), { method: "POST", body: "{bad" });
  expect((await POST(r)).status).toBe(400);
});

it("returns 400 when the body is not an object", async () => {
  const r = new NextRequest(new URL("/api/admin/authz/explain", "http://localhost:3000"), { method: "POST", body: "42" });
  expect((await POST(r)).status).toBe(400);
});
