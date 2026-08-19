/**
 * @jest-environment node
 */
import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockReadOpenFgaTuples = jest.fn();
const mockRevokeTeamAutomatorGrants = jest.fn();
const mockCascadePauseAutonomousTasksForAgents = jest.fn();
const mockCollections: Record<string, unknown> = {};

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 500) { super(message); this.statusCode = statusCode; }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: (...a: unknown[]) => mockGetAuthFromBearerOrSession(...a),
    requireRbacPermission: (...a: unknown[]) => mockRequireRbacPermission(...a),
    successResponse: (data: unknown) => NextResponse.json({ success: true, data }),
    withErrorHandler:
      (handler: (...a: unknown[]) => Promise<Response>) =>
      async (...a: unknown[]) => {
        try { return await handler(...a); }
        catch (error) {
          return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "error" },
            { status: error && typeof error === "object" && "statusCode" in error
                ? Number((error as { statusCode: number }).statusCode) : 500 },
          );
        }
      },
  };
});
jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) => mockCollections[name]),
  isMongoDBConfigured: true,
}));
jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...a: unknown[]) => mockWriteOpenFgaTuples(...a),
  readOpenFgaTuples: (...a: unknown[]) => mockReadOpenFgaTuples(...a),
}));
jest.mock("@/lib/rbac/organization", () => ({ organizationObjectId: () => "organization:caipe" }));
jest.mock("@/lib/rbac/autonomous-cascade", () => ({
  revokeTeamAutomatorGrants: (...a: unknown[]) => mockRevokeTeamAutomatorGrants(...a),
}));
jest.mock("@/lib/dynamic-agents/autonomousTaskCascade", () => ({
  cascadePauseAutonomousTasksForAgents: (...a: unknown[]) =>
    mockCascadePauseAutonomousTasksForAgents(...a),
}));

import { GET, PUT, DELETE } from "@/app/api/admin/teams/[id]/automation-capability/route";

const TEAM_ID = new ObjectId().toHexString();
const TEAM_SLUG = "platform-eng";
const CAP_TUPLE = { user: `team:${TEAM_SLUG}#member`, relation: "automation_eligible", object: "organization:caipe" };
const ctx = () => ({ params: Promise.resolve({ id: TEAM_ID }) });
const req = () => new NextRequest("http://localhost/api/admin/teams/x/automation-capability");

describe("/api/admin/teams/[id]/automation-capability", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollections.teams = { findOne: jest.fn(async () => ({ _id: new ObjectId(TEAM_ID), slug: TEAM_SLUG })) };
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user: { email: "admin@example.com" }, session: {} });
    mockRequireRbacPermission.mockResolvedValue(undefined);
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });
    mockRevokeTeamAutomatorGrants.mockResolvedValue({ count: 0, agentIds: [] });
    mockCascadePauseAutonomousTasksForAgents.mockResolvedValue({ attempted: 0, paused: 0 });
  });

  it("GET reports false when no tuple exists", async () => {
    const body = await (await GET(req(), ctx())).json();
    expect(body.data.automation_eligible).toBe(false);
    expect(mockRequireRbacPermission).toHaveBeenCalledWith({}, "admin_ui", "view");
  });
  it("PUT grants (org-admin only) and writes the member tuple", async () => {
    const body = await (await PUT(req(), ctx())).json();
    expect(body.data.automation_eligible).toBe(true);
    expect(mockRequireRbacPermission).toHaveBeenCalledWith({}, "admin_ui", "admin");
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({ writes: [CAP_TUPLE], deletes: [] });
  });
  it("PUT is idempotent when already granted", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [{ key: CAP_TUPLE }] });
    await PUT(req(), ctx());
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });
  it("non-org-admin PUT is 403", async () => {
    const { ApiError } = jest.requireMock("@/lib/api-middleware");
    mockRequireRbacPermission.mockRejectedValue(new ApiError("Forbidden", 403));
    expect((await PUT(req(), ctx())).status).toBe(403);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });
  it("PUT is 503 when OpenFGA unconfigured", async () => {
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: false, writes: 0, deletes: 0 });
    expect((await PUT(req(), ctx())).status).toBe(503);
  });
  it("DELETE cascades to revoke the team's agent automator grants", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [{ key: CAP_TUPLE }] });
    mockRevokeTeamAutomatorGrants.mockResolvedValue({ count: 3, agentIds: ["agent-a", "agent-b", "agent-c"] });
    const body = await (await DELETE(req(), ctx())).json();
    expect(body.data.automation_eligible).toBe(false);
    expect(body.data.cascaded_agent_grants).toBe(3);
    expect(mockRevokeTeamAutomatorGrants).toHaveBeenCalledWith(TEAM_SLUG);
  });

  it("DELETE pauses autonomous tasks on every agent that lost its automator grant", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [{ key: CAP_TUPLE }] });
    mockRevokeTeamAutomatorGrants.mockResolvedValue({ count: 2, agentIds: ["agent-a", "agent-b"] });
    await DELETE(req(), ctx());
    expect(mockCascadePauseAutonomousTasksForAgents).toHaveBeenCalledWith(["agent-a", "agent-b"]);
  });

  it("DELETE skips the pause cascade when no agent lost its grant", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });
    mockRevokeTeamAutomatorGrants.mockResolvedValue({ count: 0, agentIds: [] });
    await DELETE(req(), ctx());
    expect(mockCascadePauseAutonomousTasksForAgents).not.toHaveBeenCalled();
  });

  it("DELETE still succeeds when the pause cascade fails", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [{ key: CAP_TUPLE }] });
    mockRevokeTeamAutomatorGrants.mockResolvedValue({ count: 1, agentIds: ["agent-a"] });
    mockCascadePauseAutonomousTasksForAgents.mockRejectedValue(new Error("upstream down"));
    const response = await DELETE(req(), ctx());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.automation_eligible).toBe(false);
  });
});
