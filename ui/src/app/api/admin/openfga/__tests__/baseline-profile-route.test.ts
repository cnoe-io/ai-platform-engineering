/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockWithOpenFgaAdminAuth = jest.fn(
  async (_request: NextRequest, handler: (auth: unknown) => Promise<unknown>) =>
    handler({
      user: { email: "admin@example.com" },
      session: { sub: "admin-sub", org: "platform" },
    }),
);
const mockWithOpenFgaViewAuth = jest.fn(
  async (_request: NextRequest, handler: (auth: unknown) => Promise<unknown>) =>
    handler({
      user: { email: "admin@example.com" },
      session: { sub: "admin-sub", org: "platform" },
    }),
);
const mockGetCollection = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockLogOpenFgaRebacAuditEvent = jest.fn();

const profileCollection = {
  findOne: jest.fn(),
  updateOne: jest.fn(),
};
const usersCollection = {
  find: jest.fn(),
};
const teamsCollection = {
  find: jest.fn(),
  bulkWrite: jest.fn(),
};
// Post 2026-05-26 canonical-membership refactor: the route's
// reconcileBundle path queries `team_membership_sources` via
// loadTeamMembersForSlugs to resolve which users belong to each team.
// Pre-refactor it walked `team.members[]` from the teams collection.
const teamMembershipSourcesCollection = {
  find: jest.fn(),
};

jest.mock("../_lib", () => ({
  withOpenFgaAdminAuth: (...args: unknown[]) => mockWithOpenFgaAdminAuth(...args),
  withOpenFgaViewAuth: (...args: unknown[]) => mockWithOpenFgaViewAuth(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logOpenFgaRebacAuditEvent: (...args: unknown[]) => mockLogOpenFgaRebacAuditEvent(...args),
}));

function request(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CAIPE_ORG_KEY = "grid";
  profileCollection.findOne.mockResolvedValue(null);
  profileCollection.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 });
  usersCollection.find.mockReturnValue({
    limit: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { email: "member@example.com", keycloak_sub: "member-sub", role: "user" },
        { email: "admin@example.com", keycloak_sub: "admin-user-sub", role: "admin" },
      ]),
    }),
  });
  teamsCollection.find.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          _id: "team-1",
          slug: "support",
          name: "Support",
          members: [{ user_id: "member@example.com", role: "member" }],
          baseline_profile_overrides: { member_profile_id: "support-member" },
        },
      ]),
    }),
    toArray: jest.fn().mockResolvedValue([
      {
        _id: "team-1",
        slug: "support",
        name: "Support",
        members: [{ user_id: "member@example.com", role: "member" }],
        baseline_profile_overrides: { member_profile_id: "support-member" },
      },
    ]),
  });
  teamsCollection.bulkWrite.mockResolvedValue({ modifiedCount: 1 });
  // Mirror teams[0].members[] as a canonical row so loadTeamMembersForSlugs
  // returns member@example.com for slug "support".
  teamMembershipSourcesCollection.find.mockReturnValue({
    sort: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    toArray: jest.fn().mockResolvedValue([
      {
        team_slug: "support",
        user_email: "member@example.com",
        user_subject: "member-sub",
        relationship: "member",
        source_type: "manual",
        status: "active",
      },
    ]),
  });
  mockGetCollection.mockImplementation(async (name: string) => {
    if (name === "openfga_baseline_profiles") return profileCollection;
    if (name === "users") return usersCollection;
    if (name === "teams") return teamsCollection;
    if (name === "team_membership_sources") return teamMembershipSourcesCollection;
    throw new Error(`unexpected collection ${name}`);
  });
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 4, deletes: 2 });
});

describe("/api/admin/openfga/baseline-profile", () => {
  it("returns the default baseline profile with editable member and admin grant options", async () => {
    const { GET } = await import("../baseline-profile/route");

    const response = await GET(request("/api/admin/openfga/baseline-profile"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.profile.member_grants).toContain("organization-member");
    expect(body.data.profile.member_grants).toContain("admin-surface:users:read");
    expect(body.data.profile.admin_grants).toContain("organization-admin");
    expect(body.data.profile.admin_grants).toContain("admin-surface:openfga:manage");
    expect(body.data.available_grants.member).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "platform-settings-read", label: "Read platform settings" }),
      ]),
    );
    expect(body.data.available_grants.admin).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "agentgateway-manage", label: "Manage AgentGateway MCP sync" }),
      ]),
    );
  });

  it("persists edited baseline grants and reconciles all known users in realtime", async () => {
    profileCollection.findOne.mockResolvedValueOnce({
      _id: "default",
      member_grants: ["organization-member", "platform-settings-read", "admin-surface:skills:read"],
      admin_grants: ["organization-admin", "agentgateway-manage", "admin-surface:openfga:manage"],
    });
    const { PUT } = await import("../baseline-profile/route");

    const response = await PUT(
      request("/api/admin/openfga/baseline-profile", {
        method: "PUT",
        body: JSON.stringify({
          member_grants: ["organization-member", "admin-surface:users:read"],
          admin_grants: ["organization-admin", "admin-surface:migrations:manage"],
          apply: { mode: "all" },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(profileCollection.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      expect.objectContaining({
        $set: expect.objectContaining({
          member_grants: ["organization-member", "admin-surface:users:read"],
          admin_grants: ["organization-admin", "admin-surface:migrations:manage"],
          updated_by: "admin@example.com",
        }),
      }),
      { upsert: true },
    );
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        { user: "user:member-sub", relation: "member", object: "organization:grid" },
        { user: "user:member-sub", relation: "reader", object: "admin_surface:users" },
        { user: "user:admin-user-sub", relation: "manager", object: "admin_surface:migrations" },
      ]),
      deletes: expect.arrayContaining([
        { user: "user:member-sub", relation: "reader", object: "system_config:platform_settings" },
        { user: "user:admin-user-sub", relation: "manager", object: "mcp_server:agentgateway" },
        { user: "user:admin-user-sub", relation: "manager", object: "admin_surface:openfga" },
      ]),
    });
    expect(body.data.reconciliation).toMatchObject({ mode: "all", user_count: 2 });
    expect(mockLogOpenFgaRebacAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "update_baseline_profile",
        scope: "admin",
      }),
    );
  });

  it("returns profile bundle data with team override assignments", async () => {
    const { GET } = await import("../baseline-profile/route");

    const response = await GET(request("/api/admin/openfga/baseline-profile"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.bundle.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "org-member", role: "member" }),
        expect.objectContaining({ id: "org-admin", role: "admin" }),
      ]),
    );
    expect(body.data.team_assignments).toEqual([
      expect.objectContaining({
        team_id: "team-1",
        team_slug: "support",
        member_profile_id: "support-member",
      }),
    ]);
  });

  it("persists profile bundles and team overrides with override reconciliation", async () => {
    const { PUT } = await import("../baseline-profile/route");

    const response = await PUT(
      request("/api/admin/openfga/baseline-profile", {
        method: "PUT",
        body: JSON.stringify({
          bundle: {
            global_member_profile_id: "org-member",
            global_admin_profile_id: "org-admin",
            profiles: [
              { id: "org-member", name: "Organization member", role: "member", grants: ["organization-member"] },
              { id: "org-admin", name: "Organization admin", role: "admin", grants: ["organization-admin"] },
              { id: "support-member", name: "Support member", role: "member", grants: ["admin-surface:metrics:read"] },
            ],
          },
          team_assignments: [
            {
              team_id: "team-1",
              team_slug: "support",
              member_profile_id: "support-member",
            },
          ],
          apply: { mode: "all" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(profileCollection.updateOne).toHaveBeenCalledWith(
      { _id: "profiles_v2" },
      expect.objectContaining({
        $set: expect.objectContaining({
          global_member_profile_id: "org-member",
          global_admin_profile_id: "org-admin",
          updated_by: "admin@example.com",
        }),
      }),
      { upsert: true },
    );
    expect(teamsCollection.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: { _id: "team-1" },
          update: expect.objectContaining({
            $set: expect.objectContaining({
              "baseline_profile_overrides.member_profile_id": "support-member",
            }),
          }),
        }),
      }),
    ]);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        { user: "user:member-sub", relation: "reader", object: "admin_surface:metrics" },
      ]),
      deletes: expect.arrayContaining([
        { user: "user:member-sub", relation: "member", object: "organization:grid" },
      ]),
    });
  });
});
