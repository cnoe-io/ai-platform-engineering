/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const mockAuthorize = jest.fn();
const mockAuthorizeMany = jest.fn();
const mockGetAuth = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: (...a: unknown[]) => mockGetAuth(...a),
}));
jest.mock("@/lib/authz", () => ({
  authorize: (...a: unknown[]) => mockAuthorize(...a),
  authorizeMany: (...a: unknown[]) => mockAuthorizeMany(...a),
}));
jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn(), isMongoDBConfigured: false }));

import { POST } from "../authz/v1/decisions/batch/route";

function post(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/authz/v1/decisions/batch", "http://localhost:3000"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuth.mockResolvedValue({ session: { sub: "alice" } });
});

it("returns one decision per id with retriable flag, preserving input order", async () => {
  mockAuthorizeMany.mockResolvedValue(
    new Map([
      ["a", { decision: "ALLOW", reason: "OK", retriable: false }],
      ["b", { decision: "DENY", reason: "NO_CAPABILITY", retriable: false }],
    ]),
  );
  const res = await POST(
    post({ subject: { type: "user", id: "alice" }, action: "discover", resource_type: "agent", ids: ["a", "b"] }),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.results).toEqual([
    { id: "a", decision: "ALLOW", reason: "OK", retriable: false },
    { id: "b", decision: "DENY", reason: "NO_CAPABILITY", retriable: false },
  ]);
  expect(body.degraded).toBeUndefined();
});

it("emits degraded+retriable at top-level when any id is AUTHZ_UNAVAILABLE", async () => {
  // engine returns results for only one of two ids (the other is fail-closed)
  mockAuthorizeMany.mockResolvedValue(new Map([["a", { decision: "ALLOW", reason: "OK", retriable: false }]]));
  const res = await POST(
    post({ subject: { type: "user", id: "alice" }, action: "discover", resource_type: "agent", ids: ["a", "b"] }),
  );
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.results).toEqual([
    { id: "a", decision: "ALLOW", reason: "OK", retriable: false },
    { id: "b", decision: "DENY", reason: "AUTHZ_UNAVAILABLE", retriable: true },
  ]);
  expect(body.degraded).toBe(true);
  expect(body.retriable).toBe(true);
});

it("emits degraded+retriable when the engine returns AUTHZ_UNAVAILABLE for an id", async () => {
  mockAuthorizeMany.mockResolvedValue(
    new Map([
      ["a", { decision: "ALLOW", reason: "OK", retriable: false }],
      ["b", { decision: "DENY", reason: "AUTHZ_UNAVAILABLE", retriable: true }],
    ]),
  );
  const res = await POST(
    post({ subject: { type: "user", id: "alice" }, action: "discover", resource_type: "agent", ids: ["a", "b"] }),
  );
  const body = await res.json();
  expect(body.degraded).toBe(true);
  expect(body.retriable).toBe(true);
  expect(body.results[1].retriable).toBe(true);
});

it("rejects an empty id list with 400", async () => {
  const res = await POST(
    post({ subject: { type: "user", id: "alice" }, action: "discover", resource_type: "agent", ids: [] }),
  );
  expect(res.status).toBe(400);
});

it("rejects an id that smuggles OpenFGA structure", async () => {
  const res = await POST(
    post({ subject: { type: "user", id: "alice" }, action: "discover", resource_type: "agent", ids: ["ok", "agent:*"] }),
  );
  expect(res.status).toBe(400);
  expect(mockAuthorizeMany).not.toHaveBeenCalled();
});

it("returns 403 cross-subject without can_audit", async () => {
  mockAuthorize.mockResolvedValue({ decision: "DENY", reason: "NO_CAPABILITY" });
  const res = await POST(
    post({ subject: { type: "user", id: "bob" }, action: "discover", resource_type: "agent", ids: ["a"] }),
  );
  expect(res.status).toBe(403);
});

it("returns 401 when the caller token is missing/invalid", async () => {
  mockGetAuth.mockRejectedValue(new Error("no auth"));
  const res = await POST(post({ subject: { type: "user", id: "alice" }, action: "discover", resource_type: "agent", ids: ["a"] }));
  expect(res.status).toBe(401);
});

it("returns 401 when the caller has no stable sub", async () => {
  mockGetAuth.mockResolvedValue({ session: { catalogKey: "k" } });
  const res = await POST(post({ subject: { type: "user", id: "alice" }, action: "discover", resource_type: "agent", ids: ["a"] }));
  expect(res.status).toBe(401);
});

it("returns 400 on malformed JSON", async () => {
  const r = new NextRequest(new URL("/api/authz/v1/decisions/batch", "http://localhost:3000"), { method: "POST", body: "{bad" });
  expect((await POST(r)).status).toBe(400);
});

it("returns 400 when the body is not an object", async () => {
  const r = new NextRequest(new URL("/api/authz/v1/decisions/batch", "http://localhost:3000"), { method: "POST", body: "42" });
  expect((await POST(r)).status).toBe(400);
});

it("re-throws non-authz errors", async () => {
  mockAuthorizeMany.mockRejectedValue(new Error("boom"));
  await expect(
    POST(post({ subject: { type: "user", id: "alice" }, action: "discover", resource_type: "agent", ids: ["a"] })),
  ).rejects.toThrow("boom");
});
