/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

const mockGetServerSession = jest.fn();
const mockCheckPermission = jest.fn();
const mockEnsureTeamClientScope = jest.fn();
const mockListTeamMembershipSources = jest.fn();
const mockUpsertTeamMembershipSource = jest.fn();

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
  ensureTeamClientScope: (...args: unknown[]) => mockEnsureTeamClientScope(...args),
  deleteTeamClientScope: jest.fn(),
  isValidTeamSlug: jest.fn((slug: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)),
}));

jest.mock("@/lib/rbac/team-membership-source-store", () => ({
  listTeamMembershipSources: (...args: unknown[]) => mockListTeamMembershipSources(...args),
  upsertTeamMembershipSource: (...args: unknown[]) => mockUpsertTeamMembershipSource(...args),
}));

const mockCollections: Record<string, any> = {};
let mockIsMongoDBConfigured = true;

jest.mock("@/lib/mongodb", () => ({
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
  getCollection: jest.fn(async (name: string) => mockCollections[name] ?? createMockCollection()),
}));

function createMockCollection() {
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId("507f1f77bcf86cd799439011") }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
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

function adminSession() {
  return {
    user: { email: "admin@example.com", name: "Admin" },
    role: "admin",
    accessToken: accessTokenWithRoles(["admin"]),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMongoDBConfigured = true;
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockEnsureTeamClientScope.mockResolvedValue(undefined);
  mockListTeamMembershipSources.mockResolvedValue([
    {
      team_id: "507f1f77bcf86cd799439011",
      team_slug: "platform",
      user_email: "member@example.com",
      relationship: "member",
      source_type: "manual",
      managed: false,
      status: "active",
      created_by: "admin@example.com",
      created_at: "2026-05-12T00:00:00.000Z",
    },
  ]);
  mockUpsertTeamMembershipSource.mockResolvedValue(undefined);
});

describe("manual team source metadata", () => {
  it("creates manual teams with first-class source metadata and membership sources", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(null);
    mockCollections.teams = teamsCol;
    const { POST } = await import("../route");

    const response = await POST(
      makeRequest("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Platform Engineering",
          slug: "platform",
          members: ["member@example.com"],
        }),
      })
    );

    expect(response.status).toBe(201);
    const inserted = teamsCol.insertOne.mock.calls[0][0];
    expect(inserted).toEqual(
      expect.objectContaining({
        source: "manual",
        status: "active",
        created_by: "admin@example.com",
        updated_by: "admin@example.com",
      })
    );
    expect(mockUpsertTeamMembershipSource).toHaveBeenCalledWith(
      expect.objectContaining({
        team_id: "507f1f77bcf86cd799439011",
        team_slug: "platform",
        user_email: "member@example.com",
        relationship: "member",
        source_type: "manual",
        managed: false,
        status: "active",
      })
    );
    expect(mockUpsertTeamMembershipSource).toHaveBeenCalledWith(
      expect.objectContaining({
        user_email: "admin@example.com",
        relationship: "admin",
        source_type: "manual",
        managed: false,
      })
    );
  });

  it("returns membership source summaries with team details", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamId = new ObjectId("507f1f77bcf86cd799439011");
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue({
      _id: teamId,
      slug: "platform",
      name: "Platform",
      members: [],
    });
    mockCollections.teams = teamsCol;
    const { GET } = await import("../[id]/route");

    const response = await GET(makeRequest(`/api/admin/teams/${teamId}`), {
      params: Promise.resolve({ id: teamId.toString() }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockListTeamMembershipSources).toHaveBeenCalledWith(teamId.toString());
    expect(body.data.membership_sources).toEqual([
      expect.objectContaining({ source_type: "manual", status: "active" }),
    ]);
  });
});
