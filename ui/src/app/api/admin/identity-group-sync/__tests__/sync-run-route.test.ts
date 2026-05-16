/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockCheckPermission = jest.fn();
const mockPlanIdentityGroupSync = jest.fn();
const mockApplyIdentityGroupSyncPlan = jest.fn();
const mockFetchOktaExternalGroups = jest.fn();
const mockListIdentityGroupSyncRules = jest.fn();
const mockListActiveTeamMembershipSourcesForProvider = jest.fn();
const mockInsertOne = jest.fn();
const mockTeamsToArray = jest.fn();

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

jest.mock("@/lib/rbac/identity-group-sync-planner", () => ({
  planIdentityGroupSync: (...args: unknown[]) => mockPlanIdentityGroupSync(...args),
}));

jest.mock("@/lib/rbac/identity-group-sync-reconciler", () => ({
  applyIdentityGroupSyncPlan: (...args: unknown[]) => mockApplyIdentityGroupSyncPlan(...args),
}));

jest.mock("@/lib/rbac/okta-directory-connector", () => ({
  fetchOktaExternalGroups: (...args: unknown[]) => mockFetchOktaExternalGroups(...args),
}));

jest.mock("@/lib/rbac/identity-group-sync-rule-store", () => ({
  listIdentityGroupSyncRules: (...args: unknown[]) => mockListIdentityGroupSyncRules(...args),
}));

jest.mock("@/lib/rbac/team-membership-source-store", () => ({
  listActiveTeamMembershipSourcesForProvider: (...args: unknown[]) =>
    mockListActiveTeamMembershipSourcesForProvider(...args),
}));

jest.mock("@/lib/rbac/mongo-collections", () => ({
  getRbacCollection: jest.fn(async (key: string) => {
    if (key === "identityGroupSyncRuns") {
      return { insertOne: mockInsertOne };
    }
    return {};
  }),
}));

let mockIsMongoDBConfigured = true;
jest.mock("@/lib/mongodb", () => ({
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
  getCollection: jest.fn(async (name: string) => {
    if (name === "teams") {
      return {
        find: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({ toArray: mockTeamsToArray }),
        }),
      };
    }
    return {
      findOne: jest.fn().mockResolvedValue(null),
    };
  }),
}));

jest.spyOn(console, "error").mockImplementation(() => {});

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

const dryRunResult = {
  matched_groups: [{ provider_id: "oidc-claims", external_group_id: "g1", display_name: "Group" }],
  ignored_groups: [],
  teams_to_create: [],
  membership_sources_to_add: [],
  membership_sources_to_remove: [],
  tuple_writes: [],
  tuple_deletes: [],
  skipped_users: [],
  conflicts: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMongoDBConfigured = true;
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockPlanIdentityGroupSync.mockReturnValue(dryRunResult);
  mockApplyIdentityGroupSyncPlan.mockResolvedValue({
    membershipSourcesAdded: 0,
    membershipSourcesRemoved: 0,
    tupleWrites: 0,
    tupleDeletes: 0,
    openFgaEnabled: true,
  });
  mockFetchOktaExternalGroups.mockResolvedValue([
    {
      provider_id: "okta-main",
      external_group_id: "00g-platform",
      display_name: "Engineering Platform Users",
      normalized_name: "engineering platform users",
      status: "active",
      members: [],
    },
  ]);
  mockListIdentityGroupSyncRules.mockResolvedValue([{ id: "rule-platform", provider_id: "okta-main" }]);
  mockListActiveTeamMembershipSourcesForProvider.mockResolvedValue([]);
  mockTeamsToArray.mockResolvedValue([{ id: "platform", slug: "platform", name: "Platform" }]);
  mockInsertOne.mockResolvedValue({ insertedId: "run-id" });
});

describe("Identity Group Sync dry-run and apply routes", () => {
  it("runs dry-run from request-supplied groups and rules", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { POST } = await import("../dry-run/route");

    const response = await POST(
      makeRequest("/api/admin/identity-group-sync/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groups: [{ provider_id: "oidc-claims", external_group_id: "g1", display_name: "Group" }],
          rules: [{ id: "rule", provider_id: "oidc-claims" }],
          existing_teams: [],
          existing_membership_sources: [],
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.dry_run).toEqual(dryRunResult);
    expect(mockPlanIdentityGroupSync).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [expect.objectContaining({ external_group_id: "g1" })],
        rules: [expect.objectContaining({ id: "rule" })],
        existingTeams: [],
        existingMembershipSources: [],
      })
    );
  });

  it("fetches Okta inventory for provider-backed dry-runs", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { POST } = await import("../dry-run/route");

    const response = await POST(
      makeRequest("/api/admin/identity-group-sync/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_id: "okta-main", fetch_from_provider: true }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockFetchOktaExternalGroups).toHaveBeenCalledWith({ providerId: "okta-main" });
    expect(mockListIdentityGroupSyncRules).toHaveBeenCalledWith("okta-main");
    expect(mockListActiveTeamMembershipSourcesForProvider).toHaveBeenCalledWith("okta-main");
    expect(mockPlanIdentityGroupSync).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [expect.objectContaining({ provider_id: "okta-main" })],
        existingTeams: [expect.objectContaining({ slug: "platform" })],
      })
    );
  });

  it("applies only reviewed dry-runs and records a sync run", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { POST } = await import("../apply/route");

    const response = await POST(
      makeRequest("/api/admin/identity-group-sync/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewed: true, dry_run: dryRunResult }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockApplyIdentityGroupSyncPlan).toHaveBeenCalledWith(
      expect.objectContaining({ plan: dryRunResult, actor: "api" })
    );
    expect(mockInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: "applied", dry_run: dryRunResult })
    );
    expect(body.data.run.status).toBe("applied");
  });

  it("rejects apply requests that have not been reviewed", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { POST } = await import("../apply/route");

    const response = await POST(
      makeRequest("/api/admin/identity-group-sync/apply", {
        method: "POST",
        body: JSON.stringify({ dry_run: dryRunResult }),
      })
    );

    expect(response.status).toBe(400);
    expect(mockApplyIdentityGroupSyncPlan).not.toHaveBeenCalled();
  });

  it("rejects dry-runs with conflicts during apply", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { POST } = await import("../apply/route");

    const response = await POST(
      makeRequest("/api/admin/identity-group-sync/apply", {
        method: "POST",
        body: JSON.stringify({
          reviewed: true,
          dry_run: { ...dryRunResult, conflicts: [{ source_group_id: "g1", reason: "conflict" }] },
        }),
      })
    );

    expect(response.status).toBe(409);
    expect(mockApplyIdentityGroupSyncPlan).not.toHaveBeenCalled();
  });

  it("returns 503 when MongoDB is unavailable", async () => {
    mockIsMongoDBConfigured = false;
    mockGetServerSession.mockResolvedValue(adminSession());
    const { POST } = await import("../dry-run/route");

    const response = await POST(
      makeRequest("/api/admin/identity-group-sync/dry-run", {
        method: "POST",
        body: JSON.stringify({ groups: [], rules: [] }),
      })
    );

    expect(response.status).toBe(503);
  });
});
