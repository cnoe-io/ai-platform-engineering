/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

const mockGetServerSession = jest.fn();
const mockCheckPermission = jest.fn();
const mockUpsertTeamMembershipSource = jest.fn();
const mockMarkTeamMembershipSourceRemoved = jest.fn();
const mockListActiveTeamMembershipSourcesForTeamUser = jest.fn();
const mockSearchRealmUsers = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockReadTeamOpenFgaTuples = jest.fn();

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

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  searchRealmUsers: (...args: unknown[]) => mockSearchRealmUsers(...args),
  isValidTeamSlug: jest.fn((slug: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
  isOpenFgaConfigured: jest.fn(() => true),
}));

jest.mock("@/lib/rbac/team-openfga-sync-status", () => ({
  readTeamOpenFgaTuples: (...args: unknown[]) => mockReadTeamOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/team-membership-source-store", () => ({
  upsertTeamMembershipSource: (...args: unknown[]) => mockUpsertTeamMembershipSource(...args),
  markTeamMembershipSourceRemoved: (...args: unknown[]) => mockMarkTeamMembershipSourceRemoved(...args),
  listActiveTeamMembershipSourcesForTeamUser: (...args: unknown[]) =>
    mockListActiveTeamMembershipSourcesForTeamUser(...args),
}));

const mockCollections: Record<string, any> = {};
let mockIsMongoDBConfigured = true;

jest.mock("@/lib/mongodb", () => ({
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
  getCollection: jest.fn(async (name: string) => mockCollections[name] ?? createMockCollection()),
}));

const TEAM_ID = "507f1f77bcf86cd799439011";
const TEAM = {
  _id: new ObjectId(TEAM_ID),
  slug: "platform",
  name: "Platform",
  owner_id: "owner@example.com",
  members: [
    { user_id: "owner@example.com", role: "owner", added_at: new Date(), added_by: "owner@example.com" },
    { user_id: "team-admin@example.com", role: "admin", added_at: new Date(), added_by: "owner@example.com" },
    { user_id: "synced@example.com", role: "member", added_at: new Date(), added_by: "sync" },
  ],
};

function createMockCollection() {
  // The cursor supports BOTH `find().toArray()` and `find().sort().toArray()`.
  // The team-admin-guard reader (post 2026-05-26 canonical-membership refactor)
  // calls toArray() directly without sorting.
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      toArray: jest.fn().mockResolvedValue([]),
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };
}

function makeRequest(url: string, options: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), options);
}

function accessTokenWithRoles(roles: string[]): string {
  const payload = Buffer.from(JSON.stringify({ realm_access: { roles } }), "utf8").toString(
    "base64url"
  );
  return `h.${payload}.s`;
}

function session(email: string, role: "admin" | "user" = "user") {
  return {
    user: { email, name: email },
    role,
    accessToken: accessTokenWithRoles(role === "admin" ? ["admin"] : ["chat_user"]),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMongoDBConfigured = true;
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockUpsertTeamMembershipSource.mockResolvedValue(undefined);
  mockMarkTeamMembershipSourceRemoved.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  mockListActiveTeamMembershipSourcesForTeamUser.mockResolvedValue([]);
  // Echo back a deterministic Keycloak sub for the email being searched, so
  // both the add (new@example.com) and the delete (synced@example.com) paths
  // resolve to a usable user_subject without per-test setup.
  mockSearchRealmUsers.mockImplementation(
    async ({ search }: { search?: string }) => {
      const email = (search ?? "").toLowerCase();
      if (!email) return [];
      return [{ id: `kc-${email.split("@")[0]}`, email }];
    },
  );
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
  // Default: OpenFGA has no extra orphan tuples to clean up.
  mockReadTeamOpenFgaTuples.mockResolvedValue([]);
});

describe("manual membership source preservation", () => {
  const makeContext = () => ({ params: Promise.resolve({ id: TEAM_ID }) });

  it("creates a non-managed manual membership source when adding a member", async () => {
    mockGetServerSession.mockResolvedValue(session("admin@example.com", "admin"));
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValueOnce(TEAM).mockResolvedValueOnce({
      ...TEAM,
      members: [...TEAM.members, { user_id: "new@example.com", role: "member" }],
    });
    mockCollections.teams = teamsCol;
    const { POST } = await import("../route");

    const response = await POST(
      makeRequest(`/api/admin/teams/${TEAM_ID}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "new@example.com", role: "member" }),
      }),
      makeContext()
    );

    expect(response.status).toBe(201);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: "user:kc-new", relation: "member", object: "team:platform" }],
      deletes: [],
    });
    expect(mockUpsertTeamMembershipSource).toHaveBeenCalledWith(
      expect.objectContaining({
        team_id: TEAM_ID,
        team_slug: "platform",
        user_email: "new@example.com",
        relationship: "member",
        source_type: "manual",
        managed: false,
        status: "active",
        user_subject: "kc-new",
      })
    );
  });

  it("allows authorized team admins to add members", async () => {
    mockGetServerSession.mockResolvedValue(session("team-admin@example.com"));
    mockCheckPermission.mockResolvedValue({ allowed: false, reason: "DENY_NO_CAPABILITY" });
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValueOnce(TEAM).mockResolvedValueOnce({
      ...TEAM,
      members: [...TEAM.members, { user_id: "new@example.com", role: "member" }],
    });
    mockCollections.teams = teamsCol;
    // Post-canonical-membership: team-admin is recognized via the
    // canonical team_membership_sources store, not team.members[].
    const sourcesCol = createMockCollection();
    sourcesCol.find.mockReturnValue({
      sort: jest
        .fn()
        .mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      toArray: jest.fn().mockResolvedValue([
        {
          team_slug: "platform",
          user_email: "team-admin@example.com",
          relationship: "admin",
          source_type: "manual",
          status: "active",
        },
      ]),
    });
    mockCollections.team_membership_sources = sourcesCol;
    const { POST } = await import("../route");

    const response = await POST(
      makeRequest(`/api/admin/teams/${TEAM_ID}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: "new@example.com", role: "member" }),
      }),
      makeContext()
    );

    expect(response.status).toBe(201);
  });

  it("denies scoped team admins when editing unrelated teams", async () => {
    mockGetServerSession.mockResolvedValue(session("team-admin@example.com"));
    mockCheckPermission.mockResolvedValue({ allowed: false, reason: "DENY_NO_CAPABILITY" });
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue({ ...TEAM, members: [] });
    mockCollections.teams = teamsCol;
    const { POST } = await import("../route");

    const response = await POST(
      makeRequest(`/api/admin/teams/${TEAM_ID}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: "new@example.com", role: "member" }),
      }),
      makeContext()
    );

    expect(response.status).toBe(403);
  });

  it("removes only the manual source and keeps team membership while another active source grants access", async () => {
    mockGetServerSession.mockResolvedValue(session("admin@example.com", "admin"));
    mockListActiveTeamMembershipSourcesForTeamUser.mockResolvedValue([
      {
        team_id: TEAM_ID,
        team_slug: "platform",
        user_email: "synced@example.com",
        relationship: "member",
        source_type: "okta",
        provider_id: "okta-main",
        external_group_id: "00g-platform",
        managed: true,
        status: "active",
        created_at: "2026-05-12T00:00:00.000Z",
      },
    ]);
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValueOnce(TEAM).mockResolvedValueOnce(TEAM);
    mockCollections.teams = teamsCol;
    const { DELETE } = await import("../route");

    const response = await DELETE(
      makeRequest(`/api/admin/teams/${TEAM_ID}/members?user_id=synced@example.com`, {
        method: "DELETE",
      }),
      makeContext()
    );

    expect(response.status).toBe(200);
    expect(mockMarkTeamMembershipSourceRemoved).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: "manual",
        managed: false,
        user_email: "synced@example.com",
        user_subject: "kc-synced",
      }),
      "admin@example.com",
      expect.any(String)
    );
    expect(teamsCol.updateOne).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $pull: expect.anything() })
    );
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalledWith(
      expect.objectContaining({
        deletes: expect.arrayContaining([
          { user: "user:kc-synced", relation: "member", object: "team:platform" },
        ]),
      }),
    );
  });

  it("auto-reconciles orphan OpenFGA tuples when manual delete clears the last source", async () => {
    mockGetServerSession.mockResolvedValue(session("admin@example.com", "admin"));
    // No other active sources remain for this user after the manual delete.
    mockListActiveTeamMembershipSourcesForTeamUser.mockResolvedValue([]);
    // OpenFGA still has both the `member` tuple we are about to delete AND
    // a stale `admin` tuple left over from a previous partial failure.
    mockReadTeamOpenFgaTuples.mockResolvedValue([
      { user: "user:kc-synced", relation: "member", object: "team:platform" },
      { user: "user:kc-synced", relation: "admin", object: "team:platform" },
      { user: "user:kc-other", relation: "member", object: "team:platform" },
    ]);
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValueOnce(TEAM).mockResolvedValueOnce(TEAM);
    mockCollections.teams = teamsCol;
    const { DELETE } = await import("../route");

    const response = await DELETE(
      makeRequest(`/api/admin/teams/${TEAM_ID}/members?user_id=synced@example.com`, {
        method: "DELETE",
      }),
      makeContext()
    );

    expect(response.status).toBe(200);
    // Mongo source mark-removed used the resolved subject for an exact match.
    expect(mockMarkTeamMembershipSourceRemoved).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: "manual",
        user_email: "synced@example.com",
        user_subject: "kc-synced",
      }),
      "admin@example.com",
      expect.any(String)
    );
    // The role-specific `remove` write for the deleted membership.
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith(
      expect.objectContaining({
        writes: [],
        deletes: expect.arrayContaining([
          { user: "user:kc-synced", relation: "member", object: "team:platform" },
        ]),
      }),
    );
    // The auto-reconcile sweep cleared the stale `admin` tuple, but did NOT
    // touch the unrelated user's tuple.
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [],
      deletes: [
        { user: "user:kc-synced", relation: "admin", object: "team:platform" },
      ],
    });
    const sweepCalls = mockWriteOpenFgaTuples.mock.calls.filter(
      (call) => {
        const arg = call[0] as { writes: unknown[]; deletes: Array<{ user: string }> };
        return arg.deletes.some((t) => t.user === "user:kc-other");
      },
    );
    expect(sweepCalls).toHaveLength(0);
  });

  it("preserves OpenFGA tuples for the still-granted relation during orphan sweep", async () => {
    mockGetServerSession.mockResolvedValue(session("admin@example.com", "admin"));
    // After the manual delete an Okta-synced `member` source still grants access.
    mockListActiveTeamMembershipSourcesForTeamUser.mockResolvedValue([
      {
        team_id: TEAM_ID,
        team_slug: "platform",
        user_email: "synced@example.com",
        user_subject: "kc-synced",
        relationship: "member",
        source_type: "okta",
        provider_id: "okta-main",
        external_group_id: "00g-platform",
        managed: true,
        status: "active",
        created_at: "2026-05-12T00:00:00.000Z",
      },
    ]);
    mockReadTeamOpenFgaTuples.mockResolvedValue([
      { user: "user:kc-synced", relation: "member", object: "team:platform" },
    ]);
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValueOnce(TEAM).mockResolvedValueOnce(TEAM);
    mockCollections.teams = teamsCol;
    const { DELETE } = await import("../route");

    const response = await DELETE(
      makeRequest(`/api/admin/teams/${TEAM_ID}/members?user_id=synced@example.com`, {
        method: "DELETE",
      }),
      makeContext()
    );

    expect(response.status).toBe(200);
    // The `member` tuple is backed by the Okta source, so the orphan sweep
    // must NOT delete it.
    const memberDeleteCalls = mockWriteOpenFgaTuples.mock.calls.filter((call) => {
      const arg = call[0] as { deletes: Array<{ user: string; relation: string }> };
      return arg.deletes.some(
        (t) => t.user === "user:kc-synced" && t.relation === "member",
      );
    });
    expect(memberDeleteCalls).toHaveLength(0);
  });
});
