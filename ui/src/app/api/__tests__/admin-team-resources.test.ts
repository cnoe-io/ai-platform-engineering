/**
 * @jest-environment node
 */
/**
 * Spec 104 — tests for `PUT/GET /api/admin/teams/[id]/resources`.
 *
 * What we're guarding against:
 *   1. Non-admins cannot reassign team resources (auth gates fire before
 *      any KC mutation).
 *   2. Add/remove diffs are reconciled on every member: only the deltas
 *      hit Keycloak (no spurious assignments for unchanged roles).
 *   3. Members who don't yet have a Keycloak account are reported in
 *      `members_skipped` and the rest of the operation still succeeds —
 *      otherwise inviting "future" emails would brick the whole panel.
 *   4. The Mongo write happens AFTER role reconciliation so a KC outage
 *      doesn't leave Mongo and Keycloak permanently out of sync.
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

// ── Keycloak admin lib mock — central piece of this test suite ──────────────
//
// We avoid stubbing `adminFetch` directly because the route imports each
// helper function by name; mocking the whole module gives us full control
// without re-implementing pagination/parsing.
const mockEnsureRealmRole = jest.fn();
const mockFindUserIdByEmail = jest.fn();
const mockAssignRealmRolesToUser = jest.fn();
const mockRemoveRealmRolesFromUser = jest.fn();
jest.mock("@/lib/rbac/keycloak-admin", () => ({
  ensureRealmRole: (...a: unknown[]) => mockEnsureRealmRole(...a),
  findUserIdByEmail: (...a: unknown[]) => mockFindUserIdByEmail(...a),
  assignRealmRolesToUser: (...a: unknown[]) => mockAssignRealmRolesToUser(...a),
  removeRealmRolesFromUser: (...a: unknown[]) => mockRemoveRealmRolesFromUser(...a),
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
  };
}

function userSession() {
  return {
    user: { email: "user@example.com", name: "User" },
    role: "user",
    accessToken: accessTokenWithRoles(["chat_user"]),
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
  // Default: every email resolves to a fake KC id; tests override per-case.
  mockFindUserIdByEmail.mockImplementation(async (email: string) => `kc-${email}`);
  // Default: ensureRealmRole returns a stub role with a synthetic id.
  mockEnsureRealmRole.mockImplementation(async (name: string) => ({
    id: `role-${name}`,
    name,
    composite: false,
    clientRole: false,
    containerId: "caipe",
  }));
});

async function loadRoute() {
  jest.resetModules();
  setDefaultPermissionMock(true);
  // Re-bind keycloak admin mocks after resetModules.
  jest.doMock("@/lib/rbac/keycloak-admin", () => ({
    ensureRealmRole: (...a: unknown[]) => mockEnsureRealmRole(...a),
    findUserIdByEmail: (...a: unknown[]) => mockFindUserIdByEmail(...a),
    assignRealmRolesToUser: (...a: unknown[]) => mockAssignRealmRolesToUser(...a),
    removeRealmRolesFromUser: (...a: unknown[]) => mockRemoveRealmRolesFromUser(...a),
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
    expect(mockEnsureRealmRole).not.toHaveBeenCalled();
    expect(mockAssignRealmRolesToUser).not.toHaveBeenCalled();
  });

  it("returns 403 when user lacks admin_ui#admin", async () => {
    setDefaultPermissionMock(false);
    mockGetServerSession.mockResolvedValue(userSession());
    const { PUT } = await loadRoute();

    const res = await PUT(
      makeRequest(`/api/admin/teams/${TEAM_ID}/resources`, {
        method: "PUT",
        body: JSON.stringify({ agents: ["a"], tools: [] }),
      }),
      { params: Promise.resolve({ id: TEAM_ID.toString() }) }
    );

    expect(res.status).toBe(403);
    expect(mockEnsureRealmRole).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Reconciliation — only deltas are pushed to KC
// ────────────────────────────────────────────────────────────────────────────

describe("PUT /api/admin/teams/[id]/resources — reconciliation", () => {
  it("only adds/removes the diff, not the unchanged roles", async () => {
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

    // ensureRealmRole should be called for: added agent + added tool +
    // removed agent (to fetch the role object). NOT for `agent-keep` / `jira_*`
    // because those didn't change.
    const ensuredNames = mockEnsureRealmRole.mock.calls.map((c) => c[0]).sort();
    expect(ensuredNames).toEqual(
      ["agent_user:agent-drop", "agent_user:agent-new", "tool_user:github_*"].sort()
    );

    // Two members → two assigns + two removes (one role each direction).
    expect(mockAssignRealmRolesToUser).toHaveBeenCalledTimes(2);
    expect(mockRemoveRealmRolesFromUser).toHaveBeenCalledTimes(2);

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
    expect(body.data.members_updated.sort()).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
    expect(body.data.members_skipped).toEqual([]);
  });

  it("reports members that have no Keycloak account in members_skipped", async () => {
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
    expect(body.data.members_updated).toEqual(["alice@example.com"]);
    expect(body.data.members_skipped).toEqual(["bob@example.com"]);

    // Only alice gets the assignment.
    expect(mockAssignRealmRolesToUser).toHaveBeenCalledTimes(1);
    expect(mockAssignRealmRolesToUser).toHaveBeenCalledWith(
      "kc-alice@example.com",
      expect.any(Array)
    );

    // Mongo persistence must still happen even when some members are skipped —
    // otherwise re-saving on the next page load would re-trigger reconciliation
    // with stale state.
    expect(teamsCol.updateOne).toHaveBeenCalledTimes(1);
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
    expect(mockEnsureRealmRole).not.toHaveBeenCalled();
    expect(mockAssignRealmRolesToUser).not.toHaveBeenCalled();
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
});
