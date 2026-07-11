/**
 * @jest-environment node
 */
import { NextRequest, NextResponse } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireTeamMembershipManagementPermission = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockReadOpenFgaTuples = jest.fn();
const mockFindOne = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 500) { super(message); this.statusCode = statusCode; }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: (...a: unknown[]) => mockGetAuthFromBearerOrSession(...a),
    successResponse: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
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
jest.mock("@/lib/rbac/team-admin-guards", () => ({
  requireTeamMembershipManagementPermission: (...a: unknown[]) =>
    mockRequireTeamMembershipManagementPermission(...a),
}));
jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn().mockResolvedValue({ findOne: (...a: unknown[]) => mockFindOne(...a) }),
}));
jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...a: unknown[]) => mockWriteOpenFgaTuples(...a),
  readOpenFgaTuples: (...a: unknown[]) => mockReadOpenFgaTuples(...a),
}));
jest.mock("@/lib/rbac/organization", () => ({ organizationObjectId: () => "organization:caipe" }));

import { PUT, DELETE } from "@/app/api/dynamic-agents/agents/[id]/automation/route";

const AGENT_ID = "agent-deploy-bot";
const TEAM_SLUG = "platform-eng";
const ELIG_TUPLE = { user: `team:${TEAM_SLUG}#member`, relation: "automation_eligible", object: "organization:caipe" };
const AUTOMATOR_TUPLE = { user: `team:${TEAM_SLUG}#member`, relation: "automator", object: `agent:${AGENT_ID}` };
const ctx = () => ({ params: Promise.resolve({ id: AGENT_ID }) });
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/dynamic-agents/agents/x/automation", {
    method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  });

describe("/api/dynamic-agents/agents/[id]/automation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user: { email: "mgr@example.com" }, session: { sub: "s-1" } });
    mockRequireTeamMembershipManagementPermission.mockResolvedValue("team_admin");
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [{ key: ELIG_TUPLE }] });
    mockFindOne.mockResolvedValue({ _id: AGENT_ID, owner_team_slug: TEAM_SLUG });
  });

  it("PUT enables the agent for the team (writes automator tuple)", async () => {
    mockReadOpenFgaTuples
      .mockResolvedValueOnce({ tuples: [{ key: ELIG_TUPLE }] })   // eligibility present
      .mockResolvedValueOnce({ tuples: [] });                     // automator absent
    const res = await PUT(req({ team_slug: TEAM_SLUG }), ctx());
    expect(res.status).toBe(200);
    expect(mockRequireTeamMembershipManagementPermission).toHaveBeenCalledWith(
      expect.anything(),
      "mgr@example.com",
      { slug: TEAM_SLUG },
    );
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({ writes: [AUTOMATOR_TUPLE], deletes: [] });
  });

  it("PUT is rejected 409 when the team is not eligible (Layer 1 off)", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });
    const res = await PUT(req({ team_slug: TEAM_SLUG }), ctx());
    expect(res.status).toBe(409);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("PUT is 403 when caller is neither platform admin nor owner-team admin", async () => {
    const { ApiError } = jest.requireMock("@/lib/api-middleware");
    mockRequireTeamMembershipManagementPermission.mockRejectedValue(
      new ApiError("You do not have permission to manage this team", 403),
    );
    const res = await PUT(req({ team_slug: TEAM_SLUG }), ctx());
    expect(res.status).toBe(403);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("DELETE is 403 when caller is neither platform admin nor owner-team admin", async () => {
    const { ApiError } = jest.requireMock("@/lib/api-middleware");
    mockRequireTeamMembershipManagementPermission.mockRejectedValue(
      new ApiError("You do not have permission to manage this team", 403),
    );
    const res = await DELETE(req({ team_slug: TEAM_SLUG }), ctx());
    expect(res.status).toBe(403);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("PUT is 400 when team_slug is missing", async () => {
    const res = await PUT(req({}), ctx());
    expect(res.status).toBe(400);
  });

  it("PUT rejects a team_slug that is not the agent owner team", async () => {
    const res = await PUT(req({ team_slug: "other-team" }), ctx());
    expect(res.status).toBe(403);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("DELETE disables the agent for the team (deletes automator tuple)", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [{ key: AUTOMATOR_TUPLE }] });
    const res = await DELETE(req({ team_slug: TEAM_SLUG }), ctx());
    expect(res.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({ writes: [], deletes: [AUTOMATOR_TUPLE] });
  });
});
