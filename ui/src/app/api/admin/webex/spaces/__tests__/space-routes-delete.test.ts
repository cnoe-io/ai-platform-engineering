/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import { RBAC_COLLECTION_NAMES } from "@/lib/rbac/mongo-collections";

const mockCheckPermission = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockReadOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockCollections: Record<string, ReturnType<typeof createMockCollection>> = {};

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: jest.fn(async () => undefined),
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "alice-sub",
    email: "alice@example.com",
    name: "Alice Admin",
  })),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) => mockCollections[name] ?? createMockCollection([])),
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/rbac/mongo-collections", () => {
  const actual = jest.requireActual("@/lib/rbac/mongo-collections");
  return {
    ...actual,
    getRbacCollection: jest.fn(async (key: keyof typeof actual.RBAC_COLLECTION_NAMES) => {
      const name = actual.RBAC_COLLECTION_NAMES[key];
      return mockCollections[name] ?? createMockCollection([]);
    }),
  };
});

jest.mock("@/lib/config", () => ({ getConfig: (key: string) => key === "ssoEnabled" }));
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

function createMockCollection(rows: Record<string, unknown>[]) {
  return {
    rows,
    find: jest.fn(() => ({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue(rows.filter((r) => r.status === "active")),
    })),
    findOne: jest.fn(async (filter: Record<string, unknown>) =>
      rows.find((row) => row.agent_id === filter.agent_id) ?? null
    ),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    deleteOne: jest.fn(async (filter: Record<string, unknown>) => {
      const index = rows.findIndex((row) => row.agent_id === filter.agent_id);
      if (index >= 0) rows.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    }),
  };
}

const workspaceAlias = "CAIPE-WEBEX";
const workspaceId = "org-123";
const spaceId = "space-abc";

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEBEX_WORKSPACE_ALIAS = workspaceAlias;
  process.env.WEBEX_INTEGRATION_BOTS_JSON = JSON.stringify([
    { id: "primary", name: "Primary", tokenEnv: "WEBEX_PRIMARY_BOT_TOKEN" },
  ]);
  process.env.WEBEX_PRIMARY_BOT_TOKEN = "token";
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockCheckPermission.mockResolvedValue({ allowed: true });
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
  mockReadOpenFgaTuples.mockResolvedValue({ tuples: [], continuationToken: undefined });
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 1 });
  mockCollections[RBAC_COLLECTION_NAMES.webexSpaceAgentRoutes] = createMockCollection([
    {
      workspace_id: workspaceAlias,
      space_id: spaceId,
      bot_id: "primary",
      agent_id: "incident-agent",
      status: "active",
      enabled: true,
      priority: 10,
    },
  ]);
});

afterEach(() => {
  delete process.env.WEBEX_WORKSPACE_ALIAS;
  delete process.env.WEBEX_INTEGRATION_BOTS_JSON;
  delete process.env.WEBEX_PRIMARY_BOT_TOKEN;
});

describe("DELETE /api/admin/webex/spaces/.../routes", () => {
  it("deletes route metadata and removes OpenFGA tuple", async () => {
    const { DELETE } = await import("../[workspaceId]/[spaceId]/routes/route");

    const response = await DELETE(
      new NextRequest(
        `http://localhost:3000/api/admin/webex/spaces/${workspaceId}/${spaceId}/routes?bot_id=primary`,
        {
          method: "DELETE",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ agent_id: "incident-agent" }),
        }
      ),
      { params: Promise.resolve({ workspaceId, spaceId }) }
    );

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [],
      deletes: [
        {
          user: `webex_space:${workspaceAlias}--${spaceId}`,
          relation: "user",
          object: "agent:incident-agent",
        },
      ],
    });
    expect(mockCollections[RBAC_COLLECTION_NAMES.webexSpaceAgentRoutes].deleteOne).toHaveBeenCalled();
  });
});
