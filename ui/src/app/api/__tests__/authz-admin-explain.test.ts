/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockRequireRbac = jest.fn();
const mockAuthorize = jest.fn();
const mockDescribe = jest.fn();
const mockReadOpenFgaTuples = jest.fn();

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
jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...a: unknown[]) => mockReadOpenFgaTuples(...a),
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
  mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });
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

it("evaluates a permission matrix when actions[] is provided", async () => {
  mockAuthorize.mockImplementation(async (req: { action: string }) =>
    req.action === "use"
      ? { decision: "ALLOW", reason: "OK", retriable: false, via: "org_admin" }
      : { decision: "DENY", reason: "NO_CAPABILITY", retriable: false },
  );
  mockDescribe.mockImplementation((req: { action: string }) => ({
    engine: "openfga",
    relation: `can_${req.action}`,
    user: "user:bob",
    object: "agent:pe",
    store: "store-xyz",
  }));
  const res = await POST(
    post({ subject: { type: "user", id: "bob" }, resource: { type: "agent", id: "pe" }, actions: ["use", "read"] }),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.results).toHaveLength(2);
  const use = body.results.find((r: { action: string }) => r.action === "use");
  const read = body.results.find((r: { action: string }) => r.action === "read");
  expect(use.decision).toBe("ALLOW");
  expect(use.via).toBe("org_admin"); // source surfaced for the matrix
  expect(read.decision).toBe("DENY");
  expect(read.debug.relation).toBe("can_read");
});

it("marks unsupported resource actions without querying OpenFGA", async () => {
  mockAuthorize.mockResolvedValue({ decision: "ALLOW", reason: "OK", retriable: false, via: "tuple" });
  mockDescribe.mockImplementation((req: { action: string }) => ({
    engine: "openfga",
    relation: `can_${req.action}`,
    user: "user:bob",
    object: "agent:pe",
    store: "store-xyz",
  }));

  const res = await POST(
    post({ subject: { type: "user", id: "bob" }, resource: { type: "agent", id: "pe" }, actions: ["use", "ingest"] }),
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  const ingest = body.results.find((r: { action: string }) => r.action === "ingest");
  expect(ingest).toMatchObject({
    supported: false,
    decision: "DENY",
    reason: "INVALID_REQUEST",
    unsupportedReason: "capability is not supported for this resource type",
  });
  expect(mockAuthorize).toHaveBeenCalledTimes(1);
  expect(mockAuthorize).toHaveBeenCalledWith(expect.objectContaining({ action: "use" }), expect.anything());
});

it("marks inherited tuple allows as not directly revocable", async () => {
  mockAuthorize.mockResolvedValue({ decision: "ALLOW", reason: "OK", retriable: false, via: "tuple" });
  mockDescribe.mockReturnValue({
    engine: "openfga",
    relation: "can_use",
    user: "user:bob",
    object: "agent:pe",
    store: "store-xyz",
  });
  mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });

  const res = await POST(post(validBody));

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    decision: "ALLOW",
    directGrant: {
      tuple: "user:bob user agent:pe",
      present: false,
      revocable: false,
    },
  });
  expect(mockReadOpenFgaTuples).toHaveBeenCalledWith({
    tuple: { user: "user:bob", relation: "user", object: "agent:pe" },
    pageSize: 1,
  });
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
