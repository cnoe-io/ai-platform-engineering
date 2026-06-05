/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetCollection = jest.fn();
const mockGetUserTeamIds = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockFilterResourcesByPermission = jest.fn();
const mockStartWorkflowRun = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public statusCode = 500,
    ) {
      super(message);
    }
  }
  const user = { email: "alice@example.com", role: "user", name: "Alice" };
  const session = { sub: "alice-sub", role: "user" };
  return {
    ApiError,
    getAuthFromBearerOrSession: async () => ({ user, session }),
    getUserTeamIds: (...args: unknown[]) => mockGetUserTeamIds(...args),
    successResponse: (data: unknown, status = 200) => Response.json({ success: true, data }, { status }),
    withAuth: async (_request: NextRequest, handler: (...args: unknown[]) => Promise<Response>) =>
      handler(_request, user, session),
    withErrorHandler:
      <T,>(handler: (...args: unknown[]) => Promise<T>) =>
      async (...args: unknown[]) => {
        try {
          return await handler(...args);
        } catch (error) {
          return Response.json(
            { success: false, error: error instanceof Error ? error.message : "error" },
            { status: (error as { statusCode?: number }).statusCode ?? 500 },
          );
        }
      },
  };
});

const mockListUserTeamSlugs = jest.fn().mockResolvedValue(["platform-eng"]);

jest.mock("@/lib/rbac/openfga-team-membership", () => ({
  listUserTeamSlugs: (...args: unknown[]) => mockListUserTeamSlugs(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  filterResourcesByPermission: (...args: unknown[]) => mockFilterResourcesByPermission(...args),
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
  subjectFromSession: () => "alice-sub",
}));

jest.mock("@/lib/server/workflow-engine", () => ({
  detectStaleRun: jest.fn().mockResolvedValue(false),
  startWorkflowRun: (...args: unknown[]) => mockStartWorkflowRun(...args),
}));

jest.mock("@/lib/server/event-store", () => ({
  deleteEventsByRun: jest.fn(),
  readEventsByRun: jest.fn().mockResolvedValue(new Map()),
}));

function request(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

function cursor(items: unknown[]) {
  const limit = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(items) });
  const sort = jest.fn().mockReturnValue({ limit });
  const project = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(items) });
  return { sort, limit, project, toArray: jest.fn().mockResolvedValue(items) };
}

describe("workflow runs OpenFGA config access", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserTeamIds.mockResolvedValue(["legacy-team"]);
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockFilterResourcesByPermission.mockImplementation(async (_session, resources) =>
      resources.filter((resource: { _id?: string }) => resource._id === "wf-visible"),
    );
    mockStartWorkflowRun.mockResolvedValue("run-new");
  });

  it("lists runs for OpenFGA-readable workflow configs without legacy team prefiltering", async () => {
    const runCollection = {
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      find: jest.fn().mockReturnValue(cursor([{ _id: "run-1", workflow_config_id: "wf-visible" }])),
    };
    const configCollection = {
      find: jest.fn().mockReturnValue(cursor([{ _id: "wf-visible" }, { _id: "wf-hidden" }])),
    };
    mockGetCollection.mockImplementation(async (name: string) =>
      name === "workflow_runs" ? runCollection : configCollection,
    );
    const { GET } = await import("../workflow-runs/route");

    const response = await GET(request("/api/workflow-runs"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetUserTeamIds).not.toHaveBeenCalled();
    expect(configCollection.find).toHaveBeenCalledWith({});
    expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "alice-sub" }),
      [{ _id: "wf-visible" }, { _id: "wf-hidden" }],
      { type: "task", action: "read", id: expect.any(Function) },
      { bypassForOrgAdmin: true },
    );
    expect(runCollection.find).toHaveBeenCalledWith({ workflow_config_id: { $in: ["wf-visible"] } });
    expect(body).toEqual([{ _id: "run-1", workflow_config_id: "wf-visible" }]);
  });

  it("allows starting a global workflow without OpenFGA read", async () => {
    const config = {
      _id: "wf-visible",
      name: "Workflow",
      visibility: "global",
      owner_id: "other@example.com",
      steps: [],
    };
    const configCollection = { findOne: jest.fn().mockResolvedValue(config) };
    mockGetCollection.mockResolvedValue(configCollection);
    const { POST } = await import("../workflow-runs/route");

    const response = await POST(
      request("/api/workflow-runs", {
        method: "POST",
        body: JSON.stringify({ workflow_config_id: "wf-visible" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockGetUserTeamIds).not.toHaveBeenCalled();
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    expect(mockStartWorkflowRun).toHaveBeenCalledWith(
      config,
      null,
      expect.any(Object),
      expect.objectContaining({ user: { email: "alice@example.com", name: "Alice" } }),
    );
  });

  it("allows starting a team-shared workflow when the user is on that team", async () => {
    const config = {
      _id: "wf-team",
      name: "Team workflow",
      visibility: "team",
      shared_with_teams: ["platform-eng"],
      owner_id: "other@example.com",
      steps: [],
    };
    const teamsCollection = {
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([{ _id: "team-1", slug: "platform-eng" }]),
        }),
      }),
    };
    const configCollection = { findOne: jest.fn().mockResolvedValue(config) };
    mockGetCollection.mockImplementation(async (name: string) =>
      name === "teams" ? teamsCollection : configCollection,
    );

    const { POST } = await import("../workflow-runs/route");
    const response = await POST(
      request("/api/workflow-runs", {
        method: "POST",
        body: JSON.stringify({ workflow_config_id: "wf-team" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    expect(mockStartWorkflowRun).toHaveBeenCalled();
  });

  it("returns a run when the user has OpenFGA read on the parent config", async () => {
    const run = {
      _id: "run-read",
      workflow_config_id: "wf-fga-read",
      status: "running",
    };
    const config = {
      _id: "wf-fga-read",
      visibility: "private",
      owner_id: "other@example.com",
      shared_with_teams: [],
    };
    const runCollection = { findOne: jest.fn().mockResolvedValue(run) };
    const configCollection = { findOne: jest.fn().mockResolvedValue(config) };
    mockGetCollection.mockImplementation(async (name: string) =>
      name === "workflow_runs" ? runCollection : configCollection,
    );
    mockRequireResourcePermission.mockImplementation(async (_session, resource) => {
      if (resource.action === "read") {
        return undefined;
      }
      throw new Error("denied");
    });

    const { GET } = await import("../workflow-runs/route");
    const response = await GET(request("/api/workflow-runs?run_id=run-read"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body._id).toBe("run-read");
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "task", id: "wf-fga-read", action: "read" }),
      expect.anything(),
    );
  });

  it("denies run detail when the user lacks visibility and OpenFGA read/use", async () => {
    const run = {
      _id: "run-denied",
      workflow_config_id: "wf-private",
      status: "running",
    };
    const config = {
      _id: "wf-private",
      visibility: "private",
      owner_id: "other@example.com",
      shared_with_teams: [],
    };
    const runCollection = { findOne: jest.fn().mockResolvedValue(run) };
    const configCollection = { findOne: jest.fn().mockResolvedValue(config) };
    mockGetCollection.mockImplementation(async (name: string) =>
      name === "workflow_runs" ? runCollection : configCollection,
    );
    mockRequireResourcePermission.mockRejectedValue(new Error("denied"));

    const { GET } = await import("../workflow-runs/route");
    const response = await GET(request("/api/workflow-runs?run_id=run-denied"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/permission to view workflow runs/i);
  });
});
