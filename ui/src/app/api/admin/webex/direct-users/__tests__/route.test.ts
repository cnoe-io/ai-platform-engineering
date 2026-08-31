/**
 * @jest-environment node
 */

import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api-middleware";

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

function request(method: "GET" | "PUT" | "DELETE", body?: Record<string, unknown>): NextRequest {
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
  it.each([
    ["GET", () => request("GET")],
    ["PUT", () => request("PUT", { bot_id: "primary", keycloak_user_id: "user-1", agent_id: "agent-1", enabled: true })],
    ["DELETE", () => request("DELETE", { bot_id: "primary", keycloak_user_id: "user-1" })],
  ] as const)("%s requires admin_ui:admin and rejects when the caller lacks it", async (method, buildRequest) => {
    const handlers = await import("../route");
    const handler = method === "GET" ? handlers.GET : method === "PUT" ? handlers.PUT : handlers.DELETE;

    await handler(buildRequest());
    expect(mockRequireRbacPermission).toHaveBeenCalledWith(
      { sub: "admin-user" },
      "admin_ui",
      "admin",
    );

    mockRequireRbacPermission.mockRejectedValueOnce(new ApiError("Forbidden", 403));
    await expect(handler(buildRequest())).rejects.toMatchObject({ statusCode: 403 });
  });

  it("saves a direct-user route without accepting or resolving a team or an expected Webex email", async () => {
    const { PUT } = await import("../route");

    const response = await PUT(request("PUT", {
      bot_id: "primary",
      keycloak_user_id: "user-1",
      agent_id: "agent-1",
      enabled: true,
      expected_webex_email: "attacker@example.com",
      team_slug: "must-not-be-used",
    }));

    expect(response.status).toBe(200);
    expect(mockGetCollection).toHaveBeenCalledTimes(1);
    expect(mockGetCollection).toHaveBeenCalledWith("dynamic_agents");
    expect(mockUpsertRoute).toHaveBeenCalledWith({
      botId: "primary",
      keycloakUserId: "user-1",
      userEmail: "user@example.com",
      webexUserId: undefined,
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

  it("reports linked=true when the user has a webex_user_id attribute and linked=false otherwise", async () => {
    mockListRealmUsersPage.mockResolvedValueOnce([
      { id: "user-1", email: "linked@example.com", enabled: true, attributes: { webex_user_id: ["abc"] } },
      { id: "user-2", email: "unlinked@example.com", enabled: true, attributes: {} },
    ]);
    const { GET } = await import("../route");

    const response = await GET(request("GET"));
    const payload = await response.json();

    expect(payload.data.users).toEqual([
      expect.objectContaining({ keycloak_user_id: "user-1", linked: true }),
      expect.objectContaining({ keycloak_user_id: "user-2", linked: false }),
    ]);
  });

  it.each([
    ["allowlist", "active", "allowlisted", true],
    ["allowlist", "disabled", "denied", false],
    ["allowlist", undefined, "not_allowed", false],
    ["all_users", "active", "overridden", true],
    ["all_users", "disabled", "denied", false],
    ["all_users", undefined, "inherited", true],
  ] as const)(
    "classifies accessMode=%s route.status=%s as state=%s",
    async (accessMode, routeStatus, expectedState, expectedEnabled) => {
      mockRequireBot.mockResolvedValue({
        id: "primary",
        name: "Primary bot",
        available: true,
        spaces: { accessMode: "allowlist", defaultTeamSlug: null, defaultAgentId: null },
        directMessages: { accessMode, defaultAgentId: null },
      });
      mockListRealmUsersPage.mockResolvedValueOnce([
        { id: "user-1", email: "user@example.com", enabled: true, attributes: {} },
      ]);
      mockListRoutes.mockResolvedValueOnce(
        routeStatus
          ? [{ keycloak_user_id: "user-1", bot_id: "primary", user_email: "user@example.com", agent_id: "agent-1", status: routeStatus }]
          : [],
      );
      const { GET } = await import("../route");

      const response = await GET(request("GET"));
      const payload = await response.json();

      expect(payload.data.users[0]).toMatchObject({
        state: expectedState,
        enabled: expectedEnabled,
      });
    },
  );

  it("reports state=disabled when direct messages are disabled for the bot", async () => {
    mockRequireBot.mockResolvedValue({
      id: "primary",
      name: "Primary bot",
      available: true,
      spaces: { accessMode: "allowlist", defaultTeamSlug: null, defaultAgentId: null },
      directMessages: { accessMode: "disabled", defaultAgentId: null },
    });
    mockListRealmUsersPage.mockResolvedValueOnce([
      { id: "user-1", email: "user@example.com", enabled: true, attributes: {} },
    ]);
    const { GET } = await import("../route");

    const response = await GET(request("GET"));
    const payload = await response.json();

    expect(payload.data.users[0]).toMatchObject({ state: "disabled" });
  });
});
