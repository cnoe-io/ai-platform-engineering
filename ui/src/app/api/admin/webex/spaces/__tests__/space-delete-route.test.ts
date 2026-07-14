/**
 * @jest-environment node
 */

// assisted-by Codex Codex-sonnet-4-6

import { NextRequest } from "next/server";

const mockReadOpenFgaTuples = jest.fn();
const mockDeleteExactOpenFgaTuples = jest.fn();
const mockDeleteWebexSpaceAgentRoutes = jest.fn();
const mockDeleteWebexSpaceGrants = jest.fn();
const mockGetRbacCollection = jest.fn();

jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  deleteExactOpenFgaTuples: (...args: unknown[]) => mockDeleteExactOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/webex-space-grant-store", () => ({
  deleteWebexSpaceGrants: (...args: unknown[]) => mockDeleteWebexSpaceGrants(...args),
  webexSpaceSubjectId: (workspaceId: string, spaceId: string) => `${workspaceId}--${spaceId}`,
  webexWorkspaceRef: (workspaceId: string) => workspaceId,
}));

jest.mock("@/lib/rbac/webex-space-route-store", () => ({
  deleteWebexSpaceAgentRoutes: (...args: unknown[]) => mockDeleteWebexSpaceAgentRoutes(...args),
}));

jest.mock("@/lib/rbac/mongo-collections", () => ({
  getRbacCollection: (...args: unknown[]) => mockGetRbacCollection(...args),
}));

jest.mock("../_lib", () => ({
  withWebexSpaceRebacManageAuth: (
    _request: unknown,
    handler: () => Promise<unknown>,
  ) => handler(),
}));

const WORKSPACE_ID = "Cisco";
const SPACE_ID = "space-123";
const SPACE_REF = `webex_space:${WORKSPACE_ID}--${SPACE_ID}`;

function request(): NextRequest {
  return new NextRequest(
    new URL(`/api/admin/webex/spaces/${WORKSPACE_ID}/${SPACE_ID}?bot_id=primary`, "http://localhost:3000"),
    { method: "DELETE" },
  );
}

function context() {
  return { params: Promise.resolve({ workspaceId: WORKSPACE_ID, spaceId: SPACE_ID }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEBEX_INTEGRATION_BOTS_JSON = JSON.stringify([
    { id: "primary", name: "Primary", tokenEnv: "WEBEX_PRIMARY_BOT_TOKEN" },
  ]);
  process.env.WEBEX_PRIMARY_BOT_TOKEN = "token";
  mockReadOpenFgaTuples.mockResolvedValue({ tuples: [], continuationToken: undefined });
  mockDeleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, deletes: 0 });
  mockDeleteWebexSpaceAgentRoutes.mockResolvedValue(0);
  mockDeleteWebexSpaceGrants.mockResolvedValue(0);
  mockGetRbacCollection.mockResolvedValue({
    countDocuments: jest.fn(async () => 1),
    deleteMany: jest.fn(async () => ({ deletedCount: 1 })),
  });
});

afterEach(() => {
  delete process.env.WEBEX_INTEGRATION_BOTS_JSON;
  delete process.env.WEBEX_PRIMARY_BOT_TOKEN;
});

describe("DELETE /api/admin/webex/spaces/[workspaceId]/[spaceId]", () => {
  it("reads space-as-object once plus space-as-user once per grantable object type", async () => {
    const { DELETE, WEBEX_SPACE_USABLE_OBJECT_TYPES } = await import("../[workspaceId]/[spaceId]/route");

    const response = await DELETE(request(), context());
    expect(response.status).toBe(200);

    const tupleFilters = mockReadOpenFgaTuples.mock.calls.map((call) => call[0].tuple);
    expect(mockReadOpenFgaTuples).toHaveBeenCalledTimes(1 + WEBEX_SPACE_USABLE_OBJECT_TYPES.length);
    expect(tupleFilters).toContainEqual({ object: SPACE_REF });
    for (const type of WEBEX_SPACE_USABLE_OBJECT_TYPES) {
      expect(tupleFilters).toContainEqual({ object: `${type}:`, user: SPACE_REF });
    }
  });

  it("unions and dedupes tuples before deleting", async () => {
    const agentTuple = { user: SPACE_REF, relation: "user", object: "agent:incident" };
    const teamTuple = { user: "team:ops#member", relation: "user", object: SPACE_REF };
    mockReadOpenFgaTuples.mockImplementation(async (options: { tuple?: Record<string, string> }) => {
      const tuple = options.tuple ?? {};
      if (tuple.object === SPACE_REF) {
        return { tuples: [{ key: teamTuple }], continuationToken: undefined };
      }
      if (tuple.object === "agent:" || tuple.object === "tool:") {
        return { tuples: [{ key: agentTuple }], continuationToken: undefined };
      }
      return { tuples: [], continuationToken: undefined };
    });
    const { DELETE } = await import("../[workspaceId]/[spaceId]/route");

    await DELETE(request(), context());

    expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalledTimes(1);
    expect(mockDeleteExactOpenFgaTuples.mock.calls[0][0]).toEqual([
      teamTuple,
      agentTuple,
    ]);
  });

  it("aborts before Mongo cleanup if OpenFGA tuple deletion fails", async () => {
    const deleteMany = jest.fn(async () => ({ deletedCount: 1 }));
    mockGetRbacCollection.mockResolvedValue({ countDocuments: jest.fn(async () => 1), deleteMany });
    mockDeleteExactOpenFgaTuples.mockRejectedValue(new Error("openfga down"));
    const { DELETE } = await import("../[workspaceId]/[spaceId]/route");

    const response = await DELETE(request(), context());

    expect(response.status).toBe(502);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(mockDeleteWebexSpaceAgentRoutes).not.toHaveBeenCalled();
    expect(mockDeleteWebexSpaceGrants).not.toHaveBeenCalled();
  });

  it("purges Webex metadata after successful tuple deletion", async () => {
    const deleteMany = jest.fn(async () => ({ deletedCount: 2 }));
    mockGetRbacCollection.mockResolvedValue({ countDocuments: jest.fn(async () => 1), deleteMany });
    mockDeleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, deletes: 3 });
    mockDeleteWebexSpaceAgentRoutes.mockResolvedValue(4);
    mockDeleteWebexSpaceGrants.mockResolvedValue(5);
    const { DELETE } = await import("../[workspaceId]/[spaceId]/route");

    const response = await DELETE(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockDeleteWebexSpaceAgentRoutes).toHaveBeenCalledWith(WORKSPACE_ID, SPACE_ID, "primary");
    expect(mockDeleteWebexSpaceGrants).toHaveBeenCalledWith(WORKSPACE_ID, SPACE_ID);
    expect(deleteMany).toHaveBeenCalledWith({
      webex_workspace_id: WORKSPACE_ID,
      webex_space_id: SPACE_ID,
      bot_id: "primary",
    });
    expect(body.data.deleted).toMatchObject({
      workspace_id: WORKSPACE_ID,
      space_id: SPACE_ID,
      openfga_tuples: 3,
      routes: 4,
      grants: 5,
      team_mappings: 2,
    });
  });
});
