/**
 * @jest-environment node
 *
 * Pins the GET /api/admin/teams/[id] OpenFGA-sync decoration and the
 * POST /api/admin/teams/[id]/openfga/reconcile endpoint.
 *
 * Why this matters: the admin Teams page needs to show whether the team's
 * authorization state in OpenFGA matches what Mongo says about its
 * members. A drift (or an unknown state) is the diagnostic surface for
 * the OWNER_TEAM_FORBIDDEN class of bugs we've been chasing.
 */

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

const mockGetServerSession = jest.fn();
const mockCheckPermission = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockListTeamMembershipSources = jest.fn();
const mockUpsertTeamMembershipSource = jest.fn();
const mockSearchRealmUsers = jest.fn();
const mockReadOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockIsOpenFgaConfigured = jest.fn();

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
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
  isOpenFgaConfigured: () => mockIsOpenFgaConfigured(),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  // Phase 3 (spec 2026-05-24-derive-team-from-channel) removed the
  // per-team Keycloak helpers; the team CRUD routes no longer
  // import them so they don't need to be mocked.
  isValidTeamSlug: jest.fn((slug: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)),
  searchRealmUsers: (...args: unknown[]) => mockSearchRealmUsers(...args),
}));

jest.mock("@/lib/rbac/team-membership-source-store", () => ({
  listTeamMembershipSources: (...args: unknown[]) =>
    mockListTeamMembershipSources(...args),
  upsertTeamMembershipSource: (...args: unknown[]) =>
    mockUpsertTeamMembershipSource(...args),
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
  // Note: the cursor must support BOTH `find().toArray()` and
  // `find().sort().toArray()` because newer auth-gate readers (e.g.
  // team-membership-store helpers, post 2026-05-26 canonical-membership
  // refactor) call toArray() directly without a sort.
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      toArray: jest.fn().mockResolvedValue([]),
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

function nonAdminSession() {
  return {
    user: { email: "outsider@example.com", name: "Outsider" },
    role: "user",
    sub: "outsider-sub",
    accessToken: accessTokenWithRoles(["user"]),
  };
}

const TEAM_ID = "507f1f77bcf86cd799439011";

function teamDocument(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: new ObjectId(TEAM_ID),
    name: "Platform",
    slug: "platform",
    owner_id: "admin@example.com",
    members: [
      { user_id: "admin@example.com", role: "owner" },
      { user_id: "member@example.com", role: "member" },
    ],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function membershipSources(overrides: Partial<any>[] = []) {
  // Default fixture: admin is fully synced, member is fully synced.
  return [
    {
      team_id: TEAM_ID,
      team_slug: "platform",
      user_subject: "admin-sub",
      user_email: "admin@example.com",
      relationship: "admin",
      source_type: "manual",
      managed: false,
      status: "active",
      created_at: new Date().toISOString(),
      ...(overrides[0] ?? {}),
    },
    {
      team_id: TEAM_ID,
      team_slug: "platform",
      user_subject: "member-sub",
      user_email: "member@example.com",
      relationship: "member",
      source_type: "manual",
      managed: false,
      status: "active",
      created_at: new Date().toISOString(),
      ...(overrides[1] ?? {}),
    },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMongoDBConfigured = true;
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 0 });
  mockIsOpenFgaConfigured.mockReturnValue(true);
  mockSearchRealmUsers.mockImplementation(async ({ search }: { search: string }) => [
    { id: `${search}-sub`, email: search },
  ]);
});

describe("GET /api/admin/teams/[id] — no whole-team OpenFGA scan", () => {
  // Invariant: GET /api/admin/teams/[id] returns `openfga_sync: null` and
  // issues ZERO OpenFGA reads. Computing a whole-team report here would read
  // the entire `team:<slug>` tuple set on every detail view — O(team size),
  // i.e. tens of thousands of tuples for a team like `everyone` — which is
  // too expensive to pay on a page load. Per-member sync state is instead
  // computed PAGE-SCOPED by GET /api/admin/teams/[id]/members (only the
  // visible subjects are read); see members-pagination.test.ts for that
  // coverage. These tests guard against anyone re-introducing the full scan.
  it("returns openfga_sync: null and performs no OpenFGA read", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(teamDocument());
    mockCollections.teams = teamsCol;
    mockListTeamMembershipSources.mockResolvedValue(membershipSources());

    const { GET } = await import("../[id]/route");
    const response = await GET(
      makeRequest(`/api/admin/teams/${TEAM_ID}`),
      { params: Promise.resolve({ id: TEAM_ID }) },
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.openfga_sync).toBeNull();
    // Critical: the detail view must NOT scan the team's tuple set.
    expect(mockReadOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("still returns the team and its membership_sources", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(teamDocument());
    mockCollections.teams = teamsCol;
    const sources = membershipSources();
    mockListTeamMembershipSources.mockResolvedValue(sources);

    const { GET } = await import("../[id]/route");
    const response = await GET(
      makeRequest(`/api/admin/teams/${TEAM_ID}`),
      { params: Promise.resolve({ id: TEAM_ID }) },
    );

    const json = await response.json();
    expect(json.data.team.slug).toBe("platform");
    expect(json.data.membership_sources).toHaveLength(sources.length);
    expect(json.data.team.membership_sources).toHaveLength(sources.length);
  });

  it("does not scan OpenFGA even when the store is unconfigured", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    mockIsOpenFgaConfigured.mockReturnValue(false);
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(teamDocument());
    mockCollections.teams = teamsCol;
    mockListTeamMembershipSources.mockResolvedValue(membershipSources());

    const { GET } = await import("../[id]/route");
    const response = await GET(
      makeRequest(`/api/admin/teams/${TEAM_ID}`),
      { params: Promise.resolve({ id: TEAM_ID }) },
    );

    const json = await response.json();
    expect(json.data.openfga_sync).toBeNull();
    expect(mockReadOpenFgaTuples).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/teams/[id]/openfga/reconcile", () => {
  it("rejects non-admin, non-team-member callers with 403", async () => {
    mockGetServerSession.mockResolvedValue(nonAdminSession());
    // requireRbacPermission asks OpenFGA whether the caller is a platform
    // admin. Deny that, and the route falls back to `isScopedTeamAdmin`,
    // which also fails because `outsider@example.com` is not in the team
    // members. End result: 403.
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    mockCheckPermission.mockResolvedValue({ allowed: false, reason: "DENY" });
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(teamDocument());
    mockCollections.teams = teamsCol;

    const { POST } = await import("../[id]/openfga/reconcile/route");
    const response = await POST(
      makeRequest(`/api/admin/teams/${TEAM_ID}/openfga/reconcile`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: TEAM_ID }) },
    );

    expect(response.status).toBe(403);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("re-resolves missing subjects and writes the implied tuples", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(teamDocument());
    mockCollections.teams = teamsCol;
    // One row was created before the user logged in — no subject yet.
    // Reconcile must call Keycloak again, persist the resolved sub, and
    // write the member tuple.
    mockListTeamMembershipSources
      .mockResolvedValueOnce(
        membershipSources([{}, { user_subject: undefined }]),
      )
      // Second call (post-reconcile, when computing the new report) — same row
      // is now reported with the sub filled in.
      .mockResolvedValueOnce(
        membershipSources([{}, { user_subject: "member@example.com-sub" }]),
      );
    mockReadOpenFgaTuples.mockResolvedValueOnce({
      tuples: [
        {
          key: { user: "user:admin-sub", relation: "admin", object: "team:platform" },
        },
        {
          key: { user: "user:member@example.com-sub", relation: "member", object: "team:platform" },
        },
      ],
      continuationToken: undefined,
    });

    const { POST } = await import("../[id]/openfga/reconcile/route");
    const response = await POST(
      makeRequest(`/api/admin/teams/${TEAM_ID}/openfga/reconcile`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: TEAM_ID }) },
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.summary).toMatchObject({
      attempted: 2,
      resolved_subjects: 1,
      unresolved_emails: [],
    });
    // The fixed-up source row should have been persisted back with its
    // resolved user_subject.
    expect(mockUpsertTeamMembershipSource).toHaveBeenCalledWith(
      expect.objectContaining({
        user_email: "member@example.com",
        user_subject: "member@example.com-sub",
      }),
    );
    // OpenFGA must have been asked to write the missing member tuple. The
    // admin row already had its subject so its admin tuple is also
    // (idempotently) written.
    const allWrites = mockWriteOpenFgaTuples.mock.calls.flatMap(
      (call: any[]) => call[0]?.writes ?? [],
    );
    expect(allWrites).toEqual(
      expect.arrayContaining([
        { user: "user:member@example.com-sub", relation: "member", object: "team:platform" },
      ]),
    );
  });

  it("returns unresolved emails when Keycloak still cannot resolve a subject", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(teamDocument());
    mockCollections.teams = teamsCol;
    mockListTeamMembershipSources.mockResolvedValue(
      membershipSources([{}, { user_subject: undefined, user_email: "ghost@example.com" }]),
    );
    mockReadOpenFgaTuples.mockResolvedValueOnce({
      tuples: [],
      continuationToken: undefined,
    });
    // Keycloak does NOT know ghost@example.com.
    mockSearchRealmUsers.mockImplementation(
      async ({ search }: { search: string }) => {
        if (search === "ghost@example.com") return [];
        return [{ id: `${search}-sub`, email: search }];
      },
    );

    const { POST } = await import("../[id]/openfga/reconcile/route");
    const response = await POST(
      makeRequest(`/api/admin/teams/${TEAM_ID}/openfga/reconcile`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: TEAM_ID }) },
    );

    const json = await response.json();
    expect(json.data.summary.unresolved_emails).toContain("ghost@example.com");
    // No tuple should be written for the unresolved user.
    const allWrites = mockWriteOpenFgaTuples.mock.calls.flatMap(
      (call: any[]) => call[0]?.writes ?? [],
    );
    expect(
      allWrites.some((w: any) => w.user === "user:ghost@example.com-sub"),
    ).toBe(false);
  });
});
