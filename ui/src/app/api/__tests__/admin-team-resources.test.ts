/**
 * @jest-environment node
 */
/**
 * Spec 104 — tests for `PUT/GET /api/admin/teams/[id]/resources`.
 *
 * What we're guarding against:
 *   1. Non-admins cannot reassign team resources (auth gates fire before
 *      any KC mutation).
 *   2. Add/remove diffs are reconciled to OpenFGA tuples, not Keycloak roles.
 *   3. Members who don't yet have a Keycloak account are reported in
 *      `members_skipped` and the rest of the operation still succeeds —
 *      otherwise inviting "future" emails would brick the whole panel.
 *   4. The Mongo write happens AFTER OpenFGA reconciliation so persisted
 *      selection never gets ahead of the PDP state.
 */

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

// ── NextAuth + auth-config mocks (mirrors admin-teams.test.ts pattern) ──────
const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));
jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: jest.fn(),
}));
jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));
jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

// ── Mongo mock ──────────────────────────────────────────────────────────────
const mockCollections: Record<string, ReturnType<typeof createMockCollection>> = {};
const mockGetCollection = jest.fn((name: string) => {
  if (!mockCollections[name]) mockCollections[name] = createMockCollection();
  return Promise.resolve(mockCollections[name]);
});
jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

const mockFindUserIdByEmail = jest.fn();
jest.mock("@/lib/rbac/keycloak-admin", () => ({
  findUserIdByEmail: (...a: unknown[]) => mockFindUserIdByEmail(...a),
}));

const mockBuildTeamResourceTupleDiff = jest.fn();
const mockWriteOpenFgaTupleDiff = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  buildTeamResourceTupleDiff: (...a: unknown[]) => mockBuildTeamResourceTupleDiff(...a),
  writeOpenFgaTupleDiff: (...a: unknown[]) => mockWriteOpenFgaTupleDiff(...a),
  checkOpenFgaTuple: (...a: unknown[]) => mockCheckOpenFgaTuple(...a),
}));

function setDefaultPermissionMock(allow: boolean) {
  const { checkPermission } = require("@/lib/rbac/keycloak-authz") as {
    checkPermission: jest.Mock;
  };
  checkPermission.mockResolvedValue(
    allow ? { allowed: true } : { allowed: false, reason: "DENY_NO_CAPABILITY" }
  );
}

function createMockCollection() {
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
}

function makeRequest(url: string, options: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), options);
}

function accessTokenWithRoles(roles: string[]): string {
  const payload = Buffer.from(
    JSON.stringify({ realm_access: { roles } }),
    "utf8"
  ).toString("base64url");
  return `h.${payload}.s`;
}

function adminSession() {
  return {
    user: { email: "admin@example.com", name: "Admin" },
    role: "admin",
    accessToken: accessTokenWithRoles(["admin"]),
    sub: "admin-sub",
  };
}

function userSession() {
  return {
    user: { email: "user@example.com", name: "User" },
    role: "user",
    accessToken: accessTokenWithRoles(["chat_user"]),
    sub: "user-sub",
  };
}

const TEAM_ID = new ObjectId();
function teamWith(resources: { agents: string[]; tools: string[] } | undefined) {
  return {
    _id: TEAM_ID,
    name: "Demo Team",
    owner_id: "admin@example.com",
    members: [
      { user_id: "alice@example.com", role: "owner", added_at: new Date(), added_by: "admin@example.com" },
      { user_id: "bob@example.com", role: "member", added_at: new Date(), added_by: "admin@example.com" },
    ],
    created_at: new Date(),
    updated_at: new Date(),
    ...(resources ? { resources } : {}),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
  setDefaultPermissionMock(false);
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
  // Default: every email resolves to a fake KC id; tests override per-case.
  mockFindUserIdByEmail.mockImplementation(async (email: string) => `kc-${email}`);
  mockBuildTeamResourceTupleDiff.mockReturnValue({ writes: [], deletes: [] });
  mockWriteOpenFgaTupleDiff.mockResolvedValue({ enabled: false, writes: 0, deletes: 0 });
});

async function loadRoute() {
  jest.resetModules();
  setDefaultPermissionMock(true);
  // Re-bind keycloak admin mocks after resetModules.
  jest.doMock("@/lib/rbac/keycloak-admin", () => ({
    findUserIdByEmail: (...a: unknown[]) => mockFindUserIdByEmail(...a),
  }));
  jest.doMock("@/lib/rbac/openfga", () => ({
    buildTeamResourceTupleDiff: (...a: unknown[]) => mockBuildTeamResourceTupleDiff(...a),
    writeOpenFgaTupleDiff: (...a: unknown[]) => mockWriteOpenFgaTupleDiff(...a),
    checkOpenFgaTuple: (...a: unknown[]) => mockCheckOpenFgaTuple(...a),
  }));
  jest.doMock("@/lib/mongodb", () => ({
    getCollection: (...args: unknown[]) => mockGetCollection(...args),
    isMongoDBConfigured: true,
  }));
  const mod = await import("@/app/api/admin/teams/[id]/resources/route");
  return mod;
}

// ────────────────────────────────────────────────────────────────────────────
// Auth gates — these MUST fire before any Keycloak mutation
// ────────────────────────────────────────────────────────────────────────────

describe("PUT /api/admin/teams/[id]/resources — auth gating", () => {
  it("returns 401 when not authenticated and never touches Keycloak", async () => {
    setDefaultPermissionMock(true);
    mockGetServerSession.mockResolvedValue(null);
    const { PUT } = await loadRoute();

    const res = await PUT(
      makeRequest(`/api/admin/teams/${TEAM_ID}/resources`, {
        method: "PUT",
        body: JSON.stringify({ agents: ["a"], tools: [] }),
      }),
      { params: Promise.resolve({ id: TEAM_ID.toString() }) }
    );

    expect(res.status).toBe(401);
    expect(mockFindUserIdByEmail).not.toHaveBeenCalled();
    expect(mockWriteOpenFgaTupleDiff).not.toHaveBeenCalled();
  });

  it("returns 403 when user lacks admin_ui#admin", async () => {
    setDefaultPermissionMock(false);
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    mockGetServerSession.mockResolvedValue(userSession());
    const { PUT } = await loadRoute();
    setDefaultPermissionMock(false);

    const res = await PUT(
      makeRequest(`/api/admin/teams/${TEAM_ID}/resources`, {
        method: "PUT",
        body: JSON.stringify({ agents: ["a"], tools: [] }),
      }),
      { params: Promise.resolve({ id: TEAM_ID.toString() }) }
    );

    expect(res.status).toBe(403);
    expect(mockFindUserIdByEmail).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Reconciliation — OpenFGA first, no Keycloak resource-role mirroring
// ────────────────────────────────────────────────────────────────────────────

describe("PUT /api/admin/teams/[id]/resources — reconciliation", () => {
  it("persists the resource diff and does not mirror per-resource Keycloak roles", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    setDefaultPermissionMock(true);

    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(
      teamWith({
        agents: ["agent-keep", "agent-drop"],
        tools: ["jira_*"],
      })
    );
    mockCollections["teams"] = teamsCol;

    const { PUT } = await loadRoute();

    const res = await PUT(
      makeRequest(`/api/admin/teams/${TEAM_ID}/resources`, {
        method: "PUT",
        body: JSON.stringify({
          // keep agent-keep, drop agent-drop, add agent-new
          agents: ["agent-keep", "agent-new"],
          // keep jira_*, add github_*
          tools: ["jira_*", "github_*"],
        }),
      }),
      { params: Promise.resolve({ id: TEAM_ID.toString() }) }
    );

    expect(res.status).toBe(200);

    // Resource changes resolve member subjects for OpenFGA tuples, but never
    // create or assign per-resource Keycloak realm roles.
    expect(mockFindUserIdByEmail).toHaveBeenCalledWith("alice@example.com");
    expect(mockFindUserIdByEmail).toHaveBeenCalledWith("bob@example.com");

    // The Mongo write must persist the new selection.
    expect(teamsCol.updateOne).toHaveBeenCalledTimes(1);
    const update = teamsCol.updateOne.mock.calls[0][1];
    expect(update.$set.resources).toEqual({
      agents: ["agent-keep", "agent-new"],
      agent_admins: [],
      tools: ["jira_*", "github_*"],
      tool_wildcard: false,
    });

    const body = await res.json();
    // Match against the relevant keys; new agent_admin/wildcard diff fields
    // are also present but aren't the focus of this assertion.
    expect(body.data.diff).toMatchObject({
      agents_added: ["agent-new"],
      agents_removed: ["agent-drop"],
      tools_added: ["github_*"],
      tools_removed: [],
    });
    expect(body.data.members_resolved).toEqual(["alice@example.com", "bob@example.com"]);
    expect(body.data.members_skipped).toEqual([]);
  });

  it("reports missing Keycloak accounts while still saving OpenFGA resource grants", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    setDefaultPermissionMock(true);

    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(teamWith({ agents: [], tools: [] }));
    mockCollections["teams"] = teamsCol;

    // bob has not logged in yet → no KC account.
    mockFindUserIdByEmail.mockImplementation(async (email: string) =>
      email === "bob@example.com" ? null : `kc-${email}`
    );

    const { PUT } = await loadRoute();

    const res = await PUT(
      makeRequest(`/api/admin/teams/${TEAM_ID}/resources`, {
        method: "PUT",
        body: JSON.stringify({ agents: ["agent-1"], tools: [] }),
      }),
      { params: Promise.resolve({ id: TEAM_ID.toString() }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.members_resolved).toEqual(["alice@example.com"]);
    expect(body.data.members_skipped).toEqual(["bob@example.com"]);

    // Mongo persistence must still happen even when some members are skipped —
    // otherwise re-saving on the next page load would re-trigger reconciliation
    // with stale state.
    expect(teamsCol.updateOne).toHaveBeenCalledTimes(1);
  });

  it("reconciles OpenFGA tuples from team resources before persisting Mongo", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    setDefaultPermissionMock(true);

    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue({
      ...teamWith({ agents: ["agent-old"], tools: [] }),
      slug: "platform-engineering",
    });
    mockCollections["teams"] = teamsCol;
    const tupleDiff = {
      writes: [
        { user: "team:platform-engineering#member", relation: "user", object: "agent:agent-new" },
      ],
      deletes: [],
    };
    mockBuildTeamResourceTupleDiff.mockReturnValue(tupleDiff);

    const { PUT } = await loadRoute();

    const res = await PUT(
      makeRequest(`/api/admin/teams/${TEAM_ID}/resources`, {
        method: "PUT",
        body: JSON.stringify({ agents: ["agent-new"], tools: ["jira_*"] }),
      }),
      { params: Promise.resolve({ id: TEAM_ID.toString() }) }
    );

    expect(res.status).toBe(200);
    expect(mockBuildTeamResourceTupleDiff).toHaveBeenCalledWith({
      teamSlug: "platform-engineering",
      memberUserIds: ["kc-alice@example.com", "kc-bob@example.com"],
      agents: { added: ["agent-new"], removed: ["agent-old"] },
      agentAdmins: { added: [], removed: [] },
      tools: { added: ["jira_*"], removed: [] },
      toolWildcard: { added: false, removed: false },
    });
    expect(mockWriteOpenFgaTupleDiff).toHaveBeenCalledWith(tupleDiff);
    expect(teamsCol.updateOne).toHaveBeenCalledTimes(1);
  });

  it("does not persist Mongo when OpenFGA reconciliation fails", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    setDefaultPermissionMock(true);

    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue({
      ...teamWith({ agents: [], tools: [] }),
      slug: "platform-engineering",
    });
    mockCollections["teams"] = teamsCol;
    mockWriteOpenFgaTupleDiff.mockRejectedValue(new Error("OpenFGA unavailable"));

    const { PUT } = await loadRoute();

    const res = await PUT(
      makeRequest(`/api/admin/teams/${TEAM_ID}/resources`, {
        method: "PUT",
        body: JSON.stringify({ agents: ["agent-new"], tools: [] }),
      }),
      { params: Promise.resolve({ id: TEAM_ID.toString() }) }
    );

    expect(res.status).toBe(500);
    expect(teamsCol.updateOne).not.toHaveBeenCalled();
  });

  it("rejects malformed body (non-string array element)", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    setDefaultPermissionMock(true);

    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(teamWith(undefined));
    mockCollections["teams"] = teamsCol;

    const { PUT } = await loadRoute();

    const res = await PUT(
      makeRequest(`/api/admin/teams/${TEAM_ID}/resources`, {
        method: "PUT",
        body: JSON.stringify({ agents: ["ok", 42], tools: [] }),
      }),
      { params: Promise.resolve({ id: TEAM_ID.toString() }) }
    );

    expect(res.status).toBe(400);
    expect(mockFindUserIdByEmail).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GET — picker catalog shape
// ────────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/teams/[id]/resources", () => {
  it("returns current selection plus available agents/tools", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    setDefaultPermissionMock(true);

    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(
      teamWith({ agents: ["agent-1"], tools: ["jira_*"] })
    );
    mockCollections["teams"] = teamsCol;

    const agentsCol = createMockCollection();
    agentsCol.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest
          .fn()
          .mockResolvedValue([
            { _id: "agent-1", name: "Test Agent", description: "", visibility: "global" },
            { _id: "agent-2", name: "Another", description: "", visibility: "global" },
          ]),
      }),
    });
    mockCollections["dynamic_agents"] = agentsCol;

    const mcpCol = createMockCollection();
    mcpCol.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: "jira", name: "Jira", description: "Jira MCP" },
          { _id: "github", name: "GitHub", description: "GitHub MCP" },
        ]),
      }),
    });
    mockCollections["mcp_servers"] = mcpCol;

    const { GET } = await loadRoute();

    const res = await GET(
      makeRequest(`/api/admin/teams/${TEAM_ID}/resources`),
      { params: Promise.resolve({ id: TEAM_ID.toString() }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.resources.agents).toEqual(["agent-1"]);
    expect(body.data.resources.tools).toEqual(["jira_*"]);

    expect(body.data.available.agents.map((a: { id: string }) => a.id)).toEqual([
      "agent-1",
      "agent-2",
    ]);
    // Tools are surfaced as `<server>_*` prefixes.
    expect(body.data.available.tools.map((t: { id: string }) => t.id)).toEqual([
      "jira_*",
      "github_*",
    ]);
  });

  it("includes enabled Skill Hub skills in the skills picker using catalog ids", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    setDefaultPermissionMock(true);

    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(teamWith({ agents: [], tools: [] }));
    mockCollections["teams"] = teamsCol;

    const hubsCol = createMockCollection();
    hubsCol.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ id: "hub-1", enabled: true }]),
      }),
    });
    mockCollections["skill_hubs"] = hubsCol;

    const hubSkillsCol = createMockCollection();
    hubSkillsCol.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            hub_id: "hub-1",
            skill_id: "incident-triage",
            name: "Incident Triage",
            description: "Triage incidents from a shared hub",
          },
        ]),
      }),
    });
    mockCollections["hub_skills"] = hubSkillsCol;

    const { GET } = await loadRoute();

    const res = await GET(
      makeRequest(`/api/admin/teams/${TEAM_ID}/resources`),
      { params: Promise.resolve({ id: TEAM_ID.toString() }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.available.skills).toContainEqual({
      id: "hub-hub-1-incident-triage",
      name: "Incident Triage",
      description: "Triage incidents from a shared hub",
    });
  });
});
