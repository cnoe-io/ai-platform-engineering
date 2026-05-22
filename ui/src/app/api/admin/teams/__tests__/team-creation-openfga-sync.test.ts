/**
 * @jest-environment node
 *
 * Regression tests for the team-creation OpenFGA sync.
 *
 * History: `POST /api/admin/teams` used to create the Mongo doc + Keycloak
 * client scope but never write `team:<slug>#{member,admin}` tuples to OpenFGA.
 * That made `OWNER_TEAM_FORBIDDEN` fire on `POST /api/dynamic-agents` for the
 * team's own creator, because `team:<slug>#can_use` is a computed relation
 * that walks stored `member`/`admin` tuples — and there were none. These
 * tests pin the corrected behavior so we don't regress again.
 */

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

const mockGetServerSession = jest.fn();
const mockCheckPermission = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockEnsureTeamClientScope = jest.fn();
const mockListTeamMembershipSources = jest.fn();
const mockUpsertTeamMembershipSource = jest.fn();
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

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  ensureTeamClientScope: (...args: unknown[]) => mockEnsureTeamClientScope(...args),
  deleteTeamClientScope: jest.fn(),
  isValidTeamSlug: jest.fn((slug: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)),
  searchRealmUsers: (...args: unknown[]) => mockSearchRealmUsers(...args),
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
    insertOne: jest.fn().mockResolvedValue({
      insertedId: new ObjectId("507f1f77bcf86cd799439011"),
    }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };
}

function makeRequest(url: string, options: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), options);
}

function accessTokenWithRoles(roles: string[]): string {
  const payload = Buffer.from(
    JSON.stringify({ realm_access: { roles } }),
    "utf8",
  ).toString("base64url");
  return `h.${payload}.s`;
}

function adminSession() {
  return {
    user: { email: "admin@example.com", name: "Admin" },
    role: "admin",
    sub: "admin-user-sub",
    accessToken: accessTokenWithRoles(["admin"]),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMongoDBConfigured = true;
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
  mockEnsureTeamClientScope.mockResolvedValue(undefined);
  mockListTeamMembershipSources.mockResolvedValue([]);
  mockUpsertTeamMembershipSource.mockResolvedValue(undefined);
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 0 });
  // Default: Keycloak knows every email we'll throw at it. Tests that need
  // an unknown user override this for that one call.
  mockSearchRealmUsers.mockImplementation(async ({ search }: { search: string }) => [
    { id: `${search}-sub`, email: search },
  ]);
});

describe("POST /api/admin/teams — OpenFGA team-membership tuple sync", () => {
  it("writes admin+member tuples for the creator and member tuples for invitees", async () => {
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
      }),
    );

    expect(response.status).toBe(201);
    // 1. We must resolve Keycloak subs for every email we touch.
    expect(mockSearchRealmUsers).toHaveBeenCalledWith(
      expect.objectContaining({ search: "admin@example.com" }),
    );
    expect(mockSearchRealmUsers).toHaveBeenCalledWith(
      expect.objectContaining({ search: "member@example.com" }),
    );
    // 2. OpenFGA must receive the creator's admin+member tuples AND the
    //    invitee's member tuple. We don't care about call order, but every
    //    expected tuple must show up in some write batch.
    const allWrites = mockWriteOpenFgaTuples.mock.calls.flatMap(
      (call: any[]) => call[0]?.writes ?? [],
    );
    expect(allWrites).toEqual(
      expect.arrayContaining([
        { user: "user:admin@example.com-sub", relation: "admin", object: "team:platform" },
        { user: "user:admin@example.com-sub", relation: "member", object: "team:platform" },
        { user: "user:member@example.com-sub", relation: "member", object: "team:platform" },
      ]),
    );
  });

  it("dedupes the creator's email when included in the members[] array", async () => {
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
          name: "Platform",
          slug: "platform",
          // Creator's own email is also in members[] — this used to
          // produce a duplicate row in Mongo and confuse the Members tab.
          members: ["admin@example.com", "member@example.com"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    const inserted = teamsCol.insertOne.mock.calls[0][0];
    // The creator must appear exactly once, with role: 'owner'.
    const creatorRows = inserted.members.filter(
      (m: { user_id: string }) => m.user_id === "admin@example.com",
    );
    expect(creatorRows).toHaveLength(1);
    expect(creatorRows[0].role).toBe("owner");
    // And the invitee remains as a 'member' row.
    expect(inserted.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: "admin@example.com", role: "owner" }),
        expect.objectContaining({ user_id: "member@example.com", role: "member" }),
      ]),
    );
    // And we don't write a duplicate `member` tuple for the creator either —
    // they get one `admin` and one `member` tuple, full stop.
    const adminCreatorWrites = mockWriteOpenFgaTuples.mock.calls
      .flatMap((call: any[]) => call[0]?.writes ?? [])
      .filter(
        (t: any) =>
          t.user === "user:admin@example.com-sub" && t.object === "team:platform",
      );
    expect(adminCreatorWrites).toEqual(
      expect.arrayContaining([
        { user: "user:admin@example.com-sub", relation: "admin", object: "team:platform" },
        { user: "user:admin@example.com-sub", relation: "member", object: "team:platform" },
      ]),
    );
    // Exactly two tuples for the creator, no triples.
    expect(adminCreatorWrites).toHaveLength(2);
  });

  it("persists user_subject on every team_membership_source row", async () => {
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
          name: "Platform",
          slug: "platform",
          members: ["member@example.com"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    // The reconciler at lib/rbac/membership-reconciler.ts skips any source
    // row without user_subject, so this field MUST be populated at write time.
    const sourceCalls = mockUpsertTeamMembershipSource.mock.calls.map(
      (c: any[]) => c[0],
    );
    expect(sourceCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_email: "admin@example.com",
          user_subject: "admin@example.com-sub",
          relationship: "admin",
        }),
        expect.objectContaining({
          user_email: "member@example.com",
          user_subject: "member@example.com-sub",
          relationship: "member",
        }),
      ]),
    );
  });

  it("creates the team even when Keycloak cannot resolve a member's subject", async () => {
    // Real-world: an admin invites someone whose Keycloak account does not
    // exist yet. We must NOT fail the whole team creation — the team is
    // still useful, and the startup audit / next admin action can write the
    // tuple once the user logs in. We just log a warning and skip the
    // OpenFGA write for that one user.
    mockGetServerSession.mockResolvedValue(adminSession());
    mockSearchRealmUsers.mockImplementation(
      async ({ search }: { search: string }) => {
        if (search === "ghost@example.com") return [];
        return [{ id: `${search}-sub`, email: search }];
      },
    );
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(null);
    mockCollections.teams = teamsCol;
    const { POST } = await import("../route");

    const response = await POST(
      makeRequest("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Platform",
          slug: "platform",
          members: ["ghost@example.com"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    const allWrites = mockWriteOpenFgaTuples.mock.calls.flatMap(
      (call: any[]) => call[0]?.writes ?? [],
    );
    // Creator's tuples are still written.
    expect(allWrites).toEqual(
      expect.arrayContaining([
        { user: "user:admin@example.com-sub", relation: "admin", object: "team:platform" },
      ]),
    );
    // No tuple is written for the ghost user.
    expect(allWrites).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user: expect.stringContaining("ghost") }),
      ]),
    );
    // The membership source row is still upserted (without user_subject) so
    // the audit/reconciler can repair it later.
    const sourceCalls = mockUpsertTeamMembershipSource.mock.calls.map(
      (c: any[]) => c[0],
    );
    expect(sourceCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_email: "ghost@example.com",
          relationship: "member",
        }),
      ]),
    );
  });
});
