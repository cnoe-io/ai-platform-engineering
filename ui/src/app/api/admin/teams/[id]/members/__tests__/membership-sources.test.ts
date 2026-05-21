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
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
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
  mockMarkTeamMembershipSourceRemoved.mockResolvedValue(undefined);
  mockListActiveTeamMembershipSourcesForTeamUser.mockResolvedValue([]);
  mockSearchRealmUsers.mockResolvedValue([{ id: "kc-user", email: "new@example.com" }]);
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
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
      writes: [{ user: "user:kc-user", relation: "member", object: "team:platform" }],
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
        user_subject: "kc-user",
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
      }),
      "admin@example.com",
      expect.any(String)
    );
    expect(teamsCol.updateOne).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $pull: expect.anything() })
    );
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalledWith({
      writes: [],
      deletes: [{ user: "user:kc-user", relation: "member", object: "team:platform" }],
    });
  });
});
