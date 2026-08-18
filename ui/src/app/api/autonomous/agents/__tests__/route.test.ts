/**
 * @jest-environment node
 */
import { NextRequest, NextResponse } from "next/server";

const mockGetAuth = jest.fn();
const mockListObjects = jest.fn();
const mockBatchCheck = jest.fn();
const mockGetCollection = jest.fn();
const mockCheckTuple = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    statusCode: number;
    constructor(m: string, s = 500) { super(m); this.statusCode = s; }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: (...a: unknown[]) => mockGetAuth(...a),
    successResponse: (data: unknown) => NextResponse.json({ success: true, data }),
    withErrorHandler:
      (h: (...a: unknown[]) => Promise<Response>) =>
      async (...a: unknown[]) => {
        try { return await h(...a); }
        catch (e) {
          return NextResponse.json(
            { success: false, error: e instanceof Error ? e.message : "error" },
            { status: e && typeof e === "object" && "statusCode" in e ? Number((e as { statusCode: number }).statusCode) : 500 },
          );
        }
      },
  };
});
jest.mock("@/lib/rbac/openfga", () => ({
  listOpenFgaObjects: (...a: unknown[]) => mockListObjects(...a),
  batchCheckOpenFgaTuples: (...a: unknown[]) => mockBatchCheck(...a),
  checkOpenFgaTuple: (...a: unknown[]) => mockCheckTuple(...a),
}));
jest.mock("@/lib/rbac/organization", () => ({ organizationObjectId: () => "organization:test" }));
jest.mock("@/lib/mongodb", () => ({ getCollection: (...a: unknown[]) => mockGetCollection(...a) }));
// subjectFromSession returns an ALREADY-NAMESPACED subject ("user:<sub>", or
// "service_account:<sub>" for client-credentials callers). Mocking the bare
// uuid here previously hid a double-prefix bug that made every OpenFGA call
// 400 in production.
jest.mock("@/lib/rbac/resource-authz", () => ({ subjectFromSession: () => "user:sub-1" }));
jest.mock("@/lib/config", () => ({ getConfig: (k: string) => k === "autonomousAgentsEnabled" }));

import { GET } from "@/app/api/autonomous/agents/route";

const req = (query = "") =>
  new NextRequest(`http://localhost/api/autonomous/agents${query}`);

// Mongo docs keyed by the query shape the route issues.
function mockAgents(docs: Array<Record<string, unknown>>, total = docs.length) {
  mockGetCollection.mockResolvedValue({
    find: () => ({
      project: () => ({
        sort: () => ({
          skip: () => ({ limit: () => ({ toArray: async () => docs }) }),
          toArray: async () => docs,
        }),
      }),
    }),
    countDocuments: async () => total,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuth.mockResolvedValue({
    user: { email: "test-user@example.com" },
    session: { role: "user", user: { email: "test-user@example.com" } },
  });
  mockListObjects.mockResolvedValue({ objects: [] });
  mockBatchCheck.mockResolvedValue([]);
  mockCheckTuple.mockResolvedValue({ allowed: false });
  mockAgents([]);
});

it("returns empty lists and false booleans for a user with no access", async () => {
  const res = await GET(req());
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.data.schedulable).toEqual([]);
  expect(body.data.automatable).toEqual([]);
  expect(body.data.eligible).toBe(false);
  expect(body.data.can_manage_automation).toBe(false);
});

it("lists an agent the caller can schedule", async () => {
  mockListObjects.mockImplementation(async (input: { relation: string }) =>
    input.relation === "can_schedule"
      ? { objects: ["agent:deploy-agent"] }
      : { objects: [] },
  );
  mockAgents([{ _id: "deploy-agent", name: "Deploy Agent", owner_team_slug: "primary" }]);

  const res = await GET(req());
  const body = await res.json();
  expect(body.data.schedulable).toEqual([
    { id: "deploy-agent", name: "Deploy Agent", owner_team_slug: "primary" },
  ]);
});

it("marks an automatable agent with its real automator tuple state", async () => {
  mockListObjects.mockImplementation(async (input: { relation: string; type: string }) =>
    input.relation === "admin" && input.type === "team"
      ? { objects: ["team:primary"] }
      : { objects: [] },
  );
  mockAgents([{ _id: "docs-agent", name: "Docs Agent", owner_team_slug: "primary" }]);
  mockBatchCheck.mockResolvedValue([true]);

  const res = await GET(req());
  const body = await res.json();
  expect(body.data.automatable).toEqual([
    { id: "docs-agent", name: "Docs Agent", owner_team_slug: "primary", autonomous_enabled: true },
  ]);
  expect(body.data.can_manage_automation).toBe(true);
  expect(mockBatchCheck).toHaveBeenCalledWith([
    { user: "team:primary#member", relation: "automator", object: "agent:docs-agent" },
  ]);
});

it("summary mode reports eligibility from the org check and skips list resolution", async () => {
  mockCheckTuple.mockResolvedValue({ allowed: true });

  const res = await GET(req("?summary=true"));
  const body = await res.json();
  expect(body.data.eligible).toBe(true);
  expect(body.data.schedulable).toBeUndefined();
  expect(mockBatchCheck).not.toHaveBeenCalled();
  expect(mockCheckTuple).toHaveBeenCalledWith({
    user: "user:sub-1",
    relation: "can_automate",
    object: "organization:test",
  });
  expect(mockListObjects).toHaveBeenCalledWith(
    expect.objectContaining({ user: "user:sub-1", relation: "admin", type: "team" }),
  );
});

it("shows the nav for an eligible team member with no schedulable agents", async () => {
  // The whole point of Layer 1 gating: a member of an eligible team reaches the
  // page before any agent has been enabled, so the empty state can tell them
  // what to ask their team admin for.
  mockCheckTuple.mockResolvedValue({ allowed: true });
  mockListObjects.mockResolvedValue({ objects: [] });

  const res = await GET(req());
  const body = await res.json();
  expect(body.data.eligible).toBe(true);
  expect(body.data.schedulable).toEqual([]);
  expect(body.data.can_manage_automation).toBe(false);
});

it("gives a team admin the automation surface even with zero owned agents", async () => {
  mockCheckTuple.mockResolvedValue({ allowed: true });
  mockListObjects.mockImplementation(async (input: { relation: string; type: string }) =>
    input.relation === "admin" && input.type === "team"
      ? { objects: ["team:primary"] }
      : { objects: [] },
  );
  mockAgents([]);

  const res = await GET(req());
  const body = await res.json();
  expect(body.data.can_manage_automation).toBe(true);
  expect(body.data.automatable).toEqual([]);
});

it("narrows automatable by the search term", async () => {
  mockListObjects.mockImplementation(async (input: { relation: string; type: string }) =>
    input.relation === "admin" && input.type === "team"
      ? { objects: ["team:primary"] }
      : { objects: [] },
  );
  mockBatchCheck.mockResolvedValue([false]);

  const findSpy = jest.fn(() => ({
    project: () => ({
      sort: () => ({
        skip: () => ({ limit: () => ({ toArray: async () => [] }) }),
        toArray: async () => [],
      }),
    }),
  }));
  mockGetCollection.mockResolvedValue({ find: findSpy, countDocuments: async () => 0 });

  await GET(req("?search=docs"));

  expect(findSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      name: expect.objectContaining({ $regex: "docs", $options: "i" }),
    }),
  );
});

it("fails closed when OpenFGA errors", async () => {
  mockListObjects.mockRejectedValue(new Error("openfga down"));
  const res = await GET(req());
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.data.eligible).toBe(false);
  expect(body.data.can_manage_automation).toBe(false);
});

it("404s when the feature flag is off", async () => {
  jest.resetModules();
  jest.doMock("@/lib/config", () => ({ getConfig: () => false }));
  const { GET: gatedGet } = await import("@/app/api/autonomous/agents/route");
  const res = await gatedGet(req());
  expect(res.status).toBe(404);
});
