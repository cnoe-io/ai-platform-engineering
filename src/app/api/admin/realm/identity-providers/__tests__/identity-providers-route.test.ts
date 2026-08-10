/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockListIdpAliases = jest.fn();
const mockRequireResourcePermission = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(async () => null),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "slack-bot-sub",
    email: "service-account-slack-bot@local",
    name: "Slack Bot Service Account",
    isServiceAccount: true,
  })),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) =>
    mockRequireResourcePermission(...args),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  listIdpAliases: (...args: unknown[]) => mockListIdpAliases(...args),
}));

function request(): NextRequest {
  return new NextRequest(
    new URL("/api/admin/realm/identity-providers", "http://localhost:3000"),
    {
      method: "GET",
      headers: {
        Authorization: "Bearer test-token",
        "X-Client-Source": "slack-bot",
      },
    }
  );
}

function grantDirectoryReader() {
  mockRequireResourcePermission.mockResolvedValue(undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireResourcePermission.mockRejectedValue(
    Object.assign(new Error("Forbidden"), {
      statusCode: 403,
      code: "admin_surface#read",
    })
  );
  mockListIdpAliases.mockResolvedValue([]);
});

describe("GET /api/admin/realm/identity-providers", () => {
  it("summarizes enabled realm IdP brokers for the bot SA", async () => {
    grantDirectoryReader();
    mockListIdpAliases.mockResolvedValue([
      { alias: "disabled-idp", providerId: "oidc", enabled: false },
      { alias: "okta", providerId: "oidc", enabled: true },
    ]);

    const { GET } = await import("../route");
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        hasEnabledBroker: true,
        identityProviders: [
          { alias: "disabled-idp", providerId: "oidc", enabled: false },
          { alias: "okta", providerId: "oidc", enabled: true },
        ],
      },
    });
  });

  it("denies callers without the directory-read grant", async () => {
    const { GET } = await import("../route");
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("admin_surface#read");
    expect(mockListIdpAliases).not.toHaveBeenCalled();
  });
});
