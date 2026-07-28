/**
 * @jest-environment node
 */

import { NextRequest, NextResponse } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockGetCollection = jest.fn();
const mockGetRealmUserById = jest.fn();
const mockListRealmUsersPage = jest.fn();
const mockListRoutes = jest.fn();
const mockUpsertRoute = jest.fn();
const mockDeleteRoute = jest.fn();
const mockRequireBot = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public statusCode = 400) {
      super(message);
    }
  },
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
  requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
  successResponse: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
  withErrorHandler: <T>(handler: T) => handler,
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  getRealmUserById: (...args: unknown[]) => mockGetRealmUserById(...args),
  listRealmUsersPage: (...args: unknown[]) => mockListRealmUsersPage(...args),
}));

jest.mock("@/lib/rbac/webex-direct-user-route-store", () => ({
  listWebexDirectUserRoutes: (...args: unknown[]) => mockListRoutes(...args),
  upsertWebexDirectUserRoute: (...args: unknown[]) => mockUpsertRoute(...args),
  deleteWebexDirectUserRoute: (...args: unknown[]) => mockDeleteRoute(...args),
}));

jest.mock("@/lib/webex-bot-policy", () => ({
  requireAvailableWebexBotPolicy: (...args: unknown[]) => mockRequireBot(...args),
}));

function request(method: "GET" | "PUT", body?: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/admin/webex/direct-users?bot_id=primary", {
    method,
    ...(body ? {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    } : {}),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuthFromBearerOrSession.mockResolvedValue({
    user: { email: "admin@example.com" },
    session: { sub: "admin-user" },
  });
  mockRequireBot.mockResolvedValue({
    id: "primary",
    name: "Primary bot",
    available: true,
    spaces: {
      accessMode: "allowlist",
      defaultTeamSlug: null,
      defaultAgentId: null,
    },
    directMessages: {
      accessMode: "allowlist",
      defaultAgentId: null,
    },
  });
  mockGetRealmUserById.mockResolvedValue({
    id: "user-1",
    email: "user@example.com",
    enabled: true,
    attributes: {},
  });
  mockGetCollection.mockResolvedValue({
    findOne: jest.fn(async () => ({ _id: "agent-1", enabled: true })),
  });
  mockListRoutes.mockResolvedValue([]);
  mockListRealmUsersPage.mockResolvedValue([]);
  mockUpsertRoute.mockResolvedValue(undefined);
});

describe("/api/admin/webex/direct-users", () => {
  it("saves a direct-user route without accepting or resolving a team", async () => {
    const { PUT } = await import("../route");

    const response = await PUT(request("PUT", {
      bot_id: "primary",
      keycloak_user_id: "user-1",
      agent_id: "agent-1",
      enabled: true,
      expected_webex_email: "user@example.com",
      team_slug: "must-not-be-used",
    }));

    expect(response.status).toBe(200);
    expect(mockGetCollection).toHaveBeenCalledTimes(1);
    expect(mockGetCollection).toHaveBeenCalledWith("dynamic_agents");
    expect(mockUpsertRoute).toHaveBeenCalledWith({
      botId: "primary",
      keycloakUserId: "user-1",
      userEmail: "user@example.com",
      expectedWebexEmail: "user@example.com",
      agentId: "agent-1",
      enabled: true,
      actor: "admin@example.com",
    });
  });

  it("returns only the DM default agent for inherited users", async () => {
    mockRequireBot.mockResolvedValue({
      id: "primary",
      name: "Primary bot",
      available: true,
      spaces: {
        accessMode: "all_spaces",
        defaultTeamSlug: "group-team",
        defaultAgentId: "space-agent",
      },
      directMessages: {
        accessMode: "all_users",
        defaultAgentId: "dm-agent",
      },
    });
    mockListRealmUsersPage.mockResolvedValueOnce([{
      id: "user-1",
      email: "user@example.com",
      enabled: true,
      username: "user",
    }]);
    const { GET } = await import("../route");

    const response = await GET(request("GET"));
    const payload = await response.json();

    expect(payload.data.default_agent_id).toBe("dm-agent");
    expect(payload.data).not.toHaveProperty("default_team_slug");
    expect(payload.data.users[0]).toMatchObject({
      agent_id: "dm-agent",
      inherited: true,
    });
    expect(payload.data.users[0]).not.toHaveProperty("team_slug");
  });
});
