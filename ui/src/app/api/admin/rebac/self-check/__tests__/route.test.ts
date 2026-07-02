/**
 * @jest-environment node
 */

// assisted-by Codex Codex-sonnet-4-6

import { NextRequest, NextResponse } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockGetCollection = jest.fn();
const mockRunRbacSelfCheck = jest.fn();
const mockRepairableMissingTuples = jest.fn();
const mockDeleteExactOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockInvalidateUserTeamMembershipCache = jest.fn();

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

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/self-check", () => ({
  repairableMissingTuples: (...args: unknown[]) => mockRepairableMissingTuples(...args),
  runRbacSelfCheck: (...args: unknown[]) => mockRunRbacSelfCheck(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  deleteExactOpenFgaTuples: (...args: unknown[]) => mockDeleteExactOpenFgaTuples(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/openfga-team-membership", () => ({
  invalidateUserTeamMembershipCache: (...args: unknown[]) => mockInvalidateUserTeamMembershipCache(...args),
}));

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL("/api/admin/rebac/self-check", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function findChain(rows: unknown[]) {
  const toArray = jest.fn(async () => rows);
  const project = jest.fn(() => ({ toArray }));
  const find = jest.fn(() => ({ project }));
  return { find, project, toArray };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuthFromBearerOrSession.mockResolvedValue({
    session: { sub: "admin-sub", user: { email: "admin@example.com" } },
  });
  mockRequireRbacPermission.mockResolvedValue(undefined);
  mockRunRbacSelfCheck.mockResolvedValue({
    generated_at: "2026-06-27T00:00:00.000Z",
    status: "pass",
    inventory: { mongo: {}, openfga_tuple_count: 0, openfga_tuples_by_object_type: {}, organization_capability_tuples: [] },
    summary: {
      expected_tuples: 0,
      missing_tuples: 0,
      stale_references: 0,
      orphan_candidates: 0,
      repairable_findings: 0,
      total_findings: 0,
    },
    expected_by_source: {},
    missing_by_source: {},
    findings: [],
    repair_batches: [],
    notes: [],
  });
});

it("cleans stale membership sources without failing when matching OpenFGA tuples are already gone", async () => {
  const teamsChain = findChain([{ slug: "platform" }]);
  const sourceRows = [
    { _id: "row-1", team_slug: "deleted-team", user_subject: "user-1", relationship: "member" },
    { _id: "row-2", team_slug: "deleted-team", user_subject: "user-1", relationship: "member" },
    { _id: "row-3", team_slug: "deleted-team", user_subject: "user-2", relationship: "admin" },
    { _id: "row-4", team_slug: "deleted-team", user_subject: "user-3", relationship: "viewer" },
  ];
  const sourcesChain = findChain(sourceRows);
  const updateMany = jest.fn(async () => ({ matchedCount: sourceRows.length, modifiedCount: sourceRows.length }));

  mockGetCollection.mockImplementation((name: string) => {
    if (name === "teams") return { find: teamsChain.find };
    if (name === "team_membership_sources") return { find: sourcesChain.find, updateMany };
    throw new Error(`Unexpected collection ${name}`);
  });
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 1 });

  const { POST } = await import("../route");
  const response = await POST(request({ action: "cleanup_stale_team_membership_sources" }));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(mockDeleteExactOpenFgaTuples).not.toHaveBeenCalled();
  expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
    writes: [],
    deletes: [
      { user: "user:user-1", relation: "member", object: "team:deleted-team" },
      { user: "user:user-2", relation: "admin", object: "team:deleted-team" },
    ],
  });
  expect(mockWriteOpenFgaTuples.mock.invocationCallOrder[0]).toBeLessThan(updateMany.mock.invocationCallOrder[0]);
  expect(updateMany).toHaveBeenCalledWith(
    { _id: { $in: ["row-1", "row-2", "row-3", "row-4"] }, status: "active" },
    expect.objectContaining({
      $set: expect.objectContaining({
        status: "removed",
        removed_by: "rbac-self-check",
      }),
    }),
  );
  expect(mockInvalidateUserTeamMembershipCache).toHaveBeenCalledWith(["user-1", "user-2"]);
  expect(body.data.cleanup).toMatchObject({
    matched_rows: 4,
    modified_rows: 4,
    attempted_tuple_deletes: 2,
    applied_tuple_deletes: 1,
  });
});

it("cleans stale service account scopes and Webex grants for missing resources", async () => {
  const serviceAccountRows = [
    {
      _id: "sa-row-1",
      sa_sub: "sa-linked",
      scopes_snapshot: [
        { type: "agent", ref: "agent-private", added_by: "admin", added_at: new Date("2026-06-27T00:00:00Z") },
        { type: "tool", ref: "mcp-jira/*", added_by: "admin", added_at: new Date("2026-06-27T00:00:00Z") },
      ],
    },
  ];
  const webexRows = [
    {
      _id: "webex-row-1",
      workspace_id: "Cisco",
      space_id: "space-1",
      resource: { type: "agent", id: "agent-private" },
      actions: ["use"],
    },
  ];
  const serviceAccountsChain = findChain(serviceAccountRows);
  const webexChain = findChain(webexRows);
  const updateOne = jest.fn(async () => ({ modifiedCount: 1 }));
  const updateMany = jest.fn(async () => ({ modifiedCount: 1 }));

  mockGetCollection.mockImplementation((name: string) => {
    if (name === "service_accounts") return { find: serviceAccountsChain.find, updateOne };
    if (name === "webex_space_grants") return { find: webexChain.find, updateMany };
    if (name === "slack_channel_grants") return { find: findChain([]).find, updateMany: jest.fn() };
    throw new Error(`Unexpected collection ${name}`);
  });
  mockRunRbacSelfCheck
    .mockResolvedValueOnce({
      generated_at: "2026-06-27T00:00:00.000Z",
      status: "warn",
      inventory: { mongo: {}, openfga_tuple_count: 0, openfga_tuples_by_object_type: {}, organization_capability_tuples: [] },
      summary: {
        expected_tuples: 0,
        missing_tuples: 0,
        stale_references: 2,
        orphan_candidates: 0,
        repairable_findings: 0,
        total_findings: 2,
      },
      expected_by_source: {},
      missing_by_source: {},
      findings: [
        {
          id: "stale-sa-scope",
          severity: "stale_reference",
          source: "service_accounts.scopes_snapshot",
          title: "Service account scope references missing agent agent-private",
          detail: "Foo still has an agent scope for agent-private, but that agent is not in dynamic_agents.",
          fix: "Remove the stale scope from the service account or restore the missing agent.",
          repairable: false,
          resource: { type: "agent", id: "agent-private" },
        },
        {
          id: "stale-webex-grant",
          severity: "stale_reference",
          source: "webex_space_grants",
          title: "Webex grant references missing agent agent-private",
          detail: "Webex space Cisco/space-1 grants agent:agent-private, but that resource was not found.",
          fix: "Remove the stale Webex grant or restore the target resource.",
          repairable: false,
          resource: { type: "agent", id: "agent-private" },
        },
      ],
      repair_batches: [],
      notes: [],
    })
    .mockResolvedValueOnce({
      generated_at: "2026-06-27T00:00:01.000Z",
      status: "pass",
      inventory: { mongo: {}, openfga_tuple_count: 0, openfga_tuples_by_object_type: {}, organization_capability_tuples: [] },
      summary: {
        expected_tuples: 0,
        missing_tuples: 0,
        stale_references: 0,
        orphan_candidates: 0,
        repairable_findings: 0,
        total_findings: 0,
      },
      expected_by_source: {},
      missing_by_source: {},
      findings: [],
      repair_batches: [],
      notes: [],
    });
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 2 });

  const { POST } = await import("../route");
  const response = await POST(request({ action: "cleanup_stale_resource_references" }));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(updateOne).toHaveBeenCalledWith(
    { _id: "sa-row-1", status: "active" },
    expect.objectContaining({
      $set: expect.objectContaining({
        scopes_snapshot: [
          { type: "tool", ref: "mcp-jira/*", added_by: "admin", added_at: new Date("2026-06-27T00:00:00Z") },
        ],
        updated_by: "rbac-self-check",
      }),
    }),
  );
  expect(updateMany).toHaveBeenCalledWith(
    { _id: { $in: ["webex-row-1"] }, status: "active" },
    expect.objectContaining({
      $set: expect.objectContaining({
        status: "revoked",
        updated_by: "rbac-self-check",
      }),
    }),
  );
  expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
    writes: [],
    deletes: [
      { user: "service_account:sa-linked", relation: "user", object: "agent:agent-private" },
      { user: "webex_space:Cisco--space-1", relation: "user", object: "agent:agent-private" },
    ],
  });
  expect(body.data.cleanup).toMatchObject({
    matched_rows: 2,
    modified_rows: 2,
    attempted_tuple_deletes: 2,
    applied_tuple_deletes: 2,
  });
});
