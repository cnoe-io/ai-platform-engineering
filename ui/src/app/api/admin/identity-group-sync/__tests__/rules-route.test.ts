/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockCheckPermission = jest.fn();
const mockListIdentityProviders = jest.fn();
const mockListIdentityGroupSyncRules = jest.fn();
const mockUpsertIdentityGroupSyncRule = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

jest.mock("@/lib/rbac/identity-provider-store", () => ({
  listIdentityProviders: (...args: unknown[]) => mockListIdentityProviders(...args),
}));

jest.mock("@/lib/rbac/identity-group-sync-rule-store", () => ({
  listIdentityGroupSyncRules: (...args: unknown[]) => mockListIdentityGroupSyncRules(...args),
  upsertIdentityGroupSyncRule: (...args: unknown[]) => mockUpsertIdentityGroupSyncRule(...args),
}));

let mockIsMongoDBConfigured = true;
jest.mock("@/lib/mongodb", () => ({
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
  getCollection: jest.fn(async () => ({
    findOne: jest.fn().mockResolvedValue(null),
  })),
}));

function makeRequest(url: string, options: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), options);
}

function accessTokenWithRoles(roles: string[]): string {
  const payload = Buffer.from(JSON.stringify({ realm_access: { roles } }), "utf8").toString(
    "base64url"
  );
  return `h.${payload}.s`;
}

function adminSession() {
  return {
    user: { email: "admin@example.test", name: "Admin" },
    role: "admin",
    accessToken: accessTokenWithRoles(["admin"]),
    sub: "admin-sub",
  };
}

function userSession() {
  return {
    user: { email: "user@example.test", name: "User" },
    role: "user",
    accessToken: accessTokenWithRoles(["chat_user"]),
    sub: "user-sub",
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMongoDBConfigured = true;
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockListIdentityProviders.mockResolvedValue([
    {
      id: "oidc-claims",
      type: "oidc_claims",
      display_name: "OIDC Claims",
      status: "configured",
      capabilities: ["login_claim_reconciliation"],
    },
  ]);
  mockListIdentityGroupSyncRules.mockResolvedValue([
    {
      id: "rule-platform",
      provider_id: "oidc-claims",
      name: "Platform users",
      priority: 10,
      enabled: true,
      review_status: "enabled",
      include_patterns: ["^Engineering (?<team>Platform) (?<role>Users)$"],
      exclude_patterns: [],
      team_name_template: "{{team}}",
      team_slug_template: "{{team}}",
      role_map: { Users: "member" },
      auto_create_team: true,
      created_by: "test",
      created_at: "2026-05-12T00:00:00.000Z",
      updated_by: "test",
      updated_at: "2026-05-12T00:00:00.000Z",
    },
  ]);
  mockUpsertIdentityGroupSyncRule.mockResolvedValue(undefined);
});

describe("Identity Group Sync provider and rule routes", () => {
  it("lists configured identity providers for callers with admin_ui#view", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { GET } = await import("../providers/route");

    const response = await GET(makeRequest("/api/admin/identity-group-sync/providers"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.providers).toHaveLength(1);
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "admin_ui", scope: "view" })
    );
  });

  it("denies provider listing when the caller lacks admin_ui#view", async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    mockCheckPermission.mockResolvedValue({ allowed: false, reason: "DENY_NO_CAPABILITY" });
    const { GET } = await import("../providers/route");

    const response = await GET(makeRequest("/api/admin/identity-group-sync/providers"));

    expect(response.status).toBe(403);
  });

  it("lists rules filtered by provider_id for callers with admin_ui#view", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { GET } = await import("../rules/route");

    const response = await GET(
      makeRequest("/api/admin/identity-group-sync/rules?provider_id=oidc-claims")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.rules).toHaveLength(1);
    expect(mockListIdentityGroupSyncRules).toHaveBeenCalledWith("oidc-claims");
  });

  it("creates disabled draft-by-default rules through admin_ui#admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { POST } = await import("../rules/route");

    const response = await POST(
      makeRequest("/api/admin/identity-group-sync/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_id: "oidc-claims",
          name: "Engineering platform users",
          include_patterns: ["^Engineering (?<team>Platform) (?<role>Users)$"],
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.rule).toEqual(
      expect.objectContaining({
        provider_id: "oidc-claims",
        name: "Engineering platform users",
        enabled: false,
        review_status: "dry_run_required",
      })
    );
    expect(mockUpsertIdentityGroupSyncRule).toHaveBeenCalledWith(
      expect.objectContaining({ provider_id: "oidc-claims" })
    );
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "admin_ui", scope: "admin" })
    );
  });

  it("returns 400 when required rule fields are missing", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { POST } = await import("../rules/route");

    const response = await POST(
      makeRequest("/api/admin/identity-group-sync/rules", {
        method: "POST",
        body: JSON.stringify({ provider_id: "oidc-claims" }),
      })
    );

    expect(response.status).toBe(400);
  });

  it("returns 503 when MongoDB is not configured", async () => {
    mockIsMongoDBConfigured = false;
    mockGetServerSession.mockResolvedValue(adminSession());
    const { GET } = await import("../providers/route");

    const response = await GET(makeRequest("/api/admin/identity-group-sync/providers"));

    expect(response.status).toBe(503);
  });
});
