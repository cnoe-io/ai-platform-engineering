/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const mockAuthorize = jest.fn();
const mockDescribe = jest.fn();
const mockGetAuth = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: (...a: unknown[]) => mockGetAuth(...a),
}));
jest.mock("@/lib/authz", () => ({
  authorize: (...a: unknown[]) => mockAuthorize(...a),
  describeFgaCheck: (...a: unknown[]) => mockDescribe(...a),
}));
jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn(), isMongoDBConfigured: false }));

import { POST } from "../authz/v1/explain/route";

function post(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/authz/v1/explain", "http://localhost:3000"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const body = {
  subject: { type: "user", id: "bob" },
  resource: { type: "agent", id: "pe" },
  action: "use",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuth.mockResolvedValue({ session: { sub: "admin-sub" } });
});

it("denies non-auditors with 403", async () => {
  mockAuthorize.mockResolvedValue({ decision: "DENY", reason: "NO_CAPABILITY" }); // audit gate fails
  const res = await POST(post(body));
  expect(res.status).toBe(403);
});

it("returns the decision plus an OpenFGA debug block for auditors", async () => {
  // The audit gate must ALLOW (caller is an auditor); the evaluated decision
  // itself is a DENY we want to explain.
  mockAuthorize.mockImplementation(async (req: { action: string }) =>
    req.action === "audit"
      ? { decision: "ALLOW", reason: "OK", retriable: false }
      : { decision: "DENY", reason: "NO_CAPABILITY", retriable: false },
  );
  mockDescribe.mockReturnValue({
    engine: "openfga",
    relation: "can_use",
    user: "user:bob",
    object: "agent:pe",
    store: "store-xyz",
  });
  const res = await POST(post(body));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json).toMatchObject({
    decision: "DENY",
    reason: "NO_CAPABILITY",
    debug: { engine: "openfga", relation: "can_use", checked: ["user:bob can_use agent:pe"] },
  });
});

it("returns 401 when the caller has no stable sub", async () => {
  mockGetAuth.mockResolvedValue({ session: {} });
  const res = await POST(post(body));
  expect(res.status).toBe(401);
});

it("returns 401 when the caller token is missing/invalid", async () => {
  mockGetAuth.mockRejectedValue(new Error("no auth"));
  const res = await POST(post(body));
  expect(res.status).toBe(401);
});

it("returns 400 on malformed JSON (after passing the audit gate)", async () => {
  mockAuthorize.mockResolvedValue({ decision: "ALLOW", reason: "OK", retriable: false });
  const r = new NextRequest(new URL("/api/authz/v1/explain", "http://localhost:3000"), { method: "POST", body: "{bad" });
  expect((await POST(r)).status).toBe(400);
});

it("returns 400 when the body is not an object", async () => {
  mockAuthorize.mockResolvedValue({ decision: "ALLOW", reason: "OK", retriable: false });
  const r = new NextRequest(new URL("/api/authz/v1/explain", "http://localhost:3000"), { method: "POST", body: "42" });
  expect((await POST(r)).status).toBe(400);
});

it("re-throws non-authz errors", async () => {
  mockAuthorize.mockResolvedValue({ decision: "ALLOW", reason: "OK", retriable: false });
  mockDescribe.mockImplementation(() => {
    throw new Error("boom");
  });
  await expect(POST(post(body))).rejects.toThrow("boom");
});
