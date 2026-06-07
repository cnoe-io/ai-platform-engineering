/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetCollection = jest.fn();
const mockGetUserTeamIds = jest.fn();
const mockRequireWorkflowAccess = jest.fn();
const mockWorkflowAccessAllowed = jest.fn();
const mockFilterAccessibleWorkflowConfigs = jest.fn();
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

jest.mock("@/lib/server/workflow-cas-authz", () => ({
  filterAccessibleWorkflowConfigs: (...args: unknown[]) => mockFilterAccessibleWorkflowConfigs(...args),
  requireWorkflowAccess: (...args: unknown[]) => mockRequireWorkflowAccess(...args),
  workflowAccessAllowed: (...args: unknown[]) => mockWorkflowAccessAllowed(...args),
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
    mockRequireWorkflowAccess.mockResolvedValue(undefined);
    mockWorkflowAccessAllowed.mockResolvedValue(true);
    mockFilterAccessibleWorkflowConfigs.mockImplementation(async (_session, resources) =>
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
    expect(mockFilterAccessibleWorkflowConfigs).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "alice-sub" }),
      [{ _id: "wf-visible" }, { _id: "wf-hidden" }],
      expect.any(Function),
      "read",
    );
    expect(runCollection.find).toHaveBeenCalledWith({ workflow_config_id: { $in: ["wf-visible"] } });
    expect(body).toEqual([{ _id: "run-1", workflow_config_id: "wf-visible" }]);
  });

  it("requires OpenFGA read permission before starting a workflow run", async () => {
    const config = { _id: "wf-visible", name: "Workflow" };
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
    expect(mockRequireWorkflowAccess).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "alice-sub" }),
      "wf-visible",
      "read",
    );
    expect(mockStartWorkflowRun).toHaveBeenCalledWith(
      config,
      null,
      expect.any(Object),
      expect.objectContaining({ user: { email: "alice@example.com", name: "Alice" } }),
    );
  });
});
