/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockCheckPermission = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockPlanIdentityGroupSync = jest.fn();
const mockApplyIdentityGroupSyncPlan = jest.fn();
const mockFetchOktaExternalGroups = jest.fn();
const mockListIdentityGroupSyncRules = jest.fn();
const mockListActiveTeamMembershipSourcesForProvider = jest.fn();
const mockListActiveTeamMembershipSourcesForUser = jest.fn();
const mockExtractGroups = jest.fn();
const mockGetCachedOidcClaimGroups = jest.fn();
const mockInsertOne = jest.fn();
const mockTeamsToArray = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  extractGroups: (...args: unknown[]) => mockExtractGroups(...args),
  getCachedOidcClaimGroups: (...args: unknown[]) => mockGetCachedOidcClaimGroups(...args),
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
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
  listActiveTeamMembershipSourcesForUser: (...args: unknown[]) =>
    mockListActiveTeamMembershipSourcesForUser(...args),
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
  process.env.OIDC_DISCOVERY_URL = "http://keycloak:7080/realms/caipe";
  mockIsMongoDBConfigured = true;
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true, reason: "OK" });
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
  mockListActiveTeamMembershipSourcesForUser.mockResolvedValue([]);
  mockExtractGroups.mockReturnValue(["caipe-users", "caipe-admins"]);
  mockGetCachedOidcClaimGroups.mockReturnValue(["caipe-users", "caipe-admins"]);
  mockTeamsToArray.mockResolvedValue([{ id: "platform", slug: "platform", name: "Platform" }]);
  mockInsertOne.mockResolvedValue({ insertedId: "run-id" });
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      userinfo_endpoint: "http://keycloak:7080/realms/caipe/protocol/openid-connect/userinfo",
      sub: "admin-sub",
      email: "admin@example.test",
      name: "Admin",
      groups: ["caipe-users", "caipe-admins"],
    }),
  })) as jest.Mock;
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

  it("rejects risky membership removals until explicitly acknowledged", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { POST } = await import("../apply/route");
    const riskyDryRun = {
      ...dryRunResult,
      membership_sources_to_remove: [
        {
          team_id: "platform-id",
          team_slug: "platform",
          user_subject: "admin-sub",
          user_email: "admin@example.test",
          relationship: "admin",
          source_type: "oidc_claim",
          provider_id: "oidc-claims",
          external_group_id: "caipe-admins",
          sync_rule_id: "rule-admin",
          managed: true,
          status: "removed",
          created_at: "2026-05-12T00:00:00.000Z",
        },
      ],
      safety_warnings: [
        {
          code: "admin_membership_removal",
          severity: "blocker",
          message: "Admin membership would be removed.",
          requires_acknowledgement: true,
          team_slug: "platform",
          user_identifier: "admin@example.test",
        },
      ],
    };

    const response = await POST(
      makeRequest("/api/admin/identity-group-sync/apply", {
        method: "POST",
        body: JSON.stringify({
          reviewed: true,
          dry_run: riskyDryRun,
        }),
      })
    );

    expect(response.status).toBe(409);
    expect(mockApplyIdentityGroupSyncPlan).not.toHaveBeenCalled();
  });

  it("applies risky membership removals after explicit acknowledgement", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { POST } = await import("../apply/route");
    const riskyDryRun = {
      ...dryRunResult,
      membership_sources_to_remove: [
        {
          team_id: "platform-id",
          team_slug: "platform",
          user_subject: "admin-sub",
          user_email: "admin@example.test",
          relationship: "admin",
          source_type: "oidc_claim",
          provider_id: "oidc-claims",
          external_group_id: "caipe-admins",
          sync_rule_id: "rule-admin",
          managed: true,
          status: "removed",
          created_at: "2026-05-12T00:00:00.000Z",
        },
      ],
      safety_warnings: [
        {
          code: "admin_membership_removal",
          severity: "blocker",
          message: "Admin membership would be removed.",
          requires_acknowledgement: true,
        },
      ],
    };

    const response = await POST(
      makeRequest("/api/admin/identity-group-sync/apply", {
        method: "POST",
        body: JSON.stringify({
          reviewed: true,
          acknowledge_removal_risks: true,
          dry_run: riskyDryRun,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockApplyIdentityGroupSyncPlan).toHaveBeenCalledWith(
      expect.objectContaining({ plan: riskyDryRun })
    );
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

  it("suggests CAIPE teams from the current admin's OIDC group claims", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    mockListIdentityGroupSyncRules.mockResolvedValue([{ id: "rule", provider_id: "oidc-claims" }]);
    mockPlanIdentityGroupSync.mockReturnValue({
      ...dryRunResult,
      ignored_groups: [
        {
          provider_id: "oidc-claims",
          external_group_id: "caipe-users",
          display_name: "caipe-users",
          normalized_name: "caipe-users",
          status: "active",
        },
        {
          provider_id: "oidc-claims",
          external_group_id: "caipe-admins",
          display_name: "caipe-admins",
          normalized_name: "caipe-admins",
          status: "active",
        },
      ],
    });
    const { GET } = await import("../claim-suggestions/route");

    const response = await GET(makeRequest("/api/admin/identity-group-sync/claim-suggestions"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetCachedOidcClaimGroups).toHaveBeenCalledWith("admin-sub");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockExtractGroups).not.toHaveBeenCalled();
    expect(mockPlanIdentityGroupSync).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: expect.arrayContaining([
          expect.objectContaining({ external_group_id: "caipe-users" }),
          expect.objectContaining({ external_group_id: "caipe-admins" }),
        ]),
        rules: [expect.objectContaining({ id: "rule" })],
      })
    );
    expect(mockListActiveTeamMembershipSourcesForUser).toHaveBeenCalledWith({
      providerId: "oidc-claims",
      sourceType: "oidc_claim",
      userSubject: "admin-sub",
      userEmail: "admin@example.test",
    });
    expect(body.data.suggestions).toEqual([
      expect.objectContaining({
        source_group_id: "caipe-users",
        suggested_team_slug: "caipe-users",
        suggested_relationship: "member",
        suggested_org_admin: false,
      }),
      expect.objectContaining({
        source_group_id: "caipe-admins",
        suggested_team_slug: "caipe-admins",
        suggested_relationship: "admin",
        suggested_org_admin: true,
      }),
    ]);
  });

  it("returns an empty suggestion set when userinfo has no group claims", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    mockGetCachedOidcClaimGroups.mockReturnValue([]);
    const { GET } = await import("../claim-suggestions/route");

    const response = await GET(makeRequest("/api/admin/identity-group-sync/claim-suggestions"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.groups).toEqual([]);
    expect(body.data.suggestions).toEqual([]);
    expect(body.data.reason).toBe("missing_session_group_claims");
    expect(mockPlanIdentityGroupSync).not.toHaveBeenCalled();
  });
});
