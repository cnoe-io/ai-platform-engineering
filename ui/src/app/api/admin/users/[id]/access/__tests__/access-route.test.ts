/**
 * @jest-environment node
 *
 * Tests for GET /api/admin/users/[id]/access — the read-only "what can this
 * user reach, and which team granted it?" view that replaced the low-level
 * Permissions Tool.
 *
 * Grants are read LIVE from OpenFGA `list-objects` (the single source of truth
 * — the `team.resources` array and `team_kb_ownership` collection are both gone),
 * so these tests seed grants by mocking `listOpenFgaObjects` keyed on
 * (`team:<slug>#member`|`#admin`, relation, type) for team grants — including KB
 * grants on type `knowledge_base` — and (`user:<sub>`, owner, type) for
 * owner-direct grants.
 *
 * Covers:
 *  - aggregates agents/tools/skills/workflows/KBs from the user's active teams;
 *  - admin role unlocks agent manage (`#admin manager`) and members do not;
 *  - the same resource granted by two teams merges into one item with two
 *    `via` entries;
 *  - personally-owned (non-team) resources surface with `kind: "owned"`;
 *  - a user with no email / no memberships returns empty access;
 *  - 503 when MongoDB is not configured.
 */

import { NextRequest } from "next/server";

const mockGetAuth = jest.fn();
const mockRequireUserProfileRead = jest.fn();
const mockGetRealmUserById = jest.fn();
const mockMembershipFind = jest.fn();
const mockTeamsFind = jest.fn();
const mockAgentsFind = jest.fn();
const mockListOpenFgaObjects = jest.fn();

let mongoConfigured = true;

/**
 * OpenFGA `list-objects` stub driven by a simple grant table. Each entry maps a
 * (user, relation, type) tuple key to the object ids granted under it. Tests set
 * `grantTable` per scenario; unlisted lookups return no objects.
 */
type GrantTable = Record<string, string[]>;
let grantTable: GrantTable = {};

function grantKey(user: string, relation: string, type: string): string {
  return `${user}|${relation}|${type}`;
}

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuth(...args),
  };
});

jest.mock("@/lib/mongodb", () => ({
  get isMongoDBConfigured() {
    return mongoConfigured;
  },
  getCollection: async (name: string) => {
    if (name === "teams") {
      return { find: (...a: unknown[]) => ({ toArray: () => mockTeamsFind(...a) }) };
    }
    if (name === "dynamic_agents") {
      return {
        find: (...a: unknown[]) => ({ toArray: () => mockAgentsFind(...a) }),
      };
    }
    throw new Error(`unexpected getCollection(${name})`);
  },
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  getRealmUserById: (...args: unknown[]) => mockGetRealmUserById(...args),
}));

jest.mock("@/lib/rbac/require-openfga", () => ({
  requireUserProfileRead: (...args: unknown[]) =>
    mockRequireUserProfileRead(...args),
}));

jest.mock("@/lib/rbac/mongo-collections", () => ({
  getRbacCollection: async () => ({
    find: () => ({
      project: () => ({ toArray: () => mockMembershipFind() }),
    }),
  }),
}));

// Grants flow through listOpenFgaObjects (directly for owner-direct grants, and
// transitively via team-resource-listing's batch/cache helpers for team grants).
jest.mock("@/lib/rbac/openfga", () => {
  const actual = jest.requireActual("@/lib/rbac/openfga");
  return {
    ...actual,
    listOpenFgaObjects: (...args: unknown[]) => mockListOpenFgaObjects(...args),
  };
});

function request(id: string) {
  const req = new NextRequest(
    new URL(`/api/admin/users/${id}/access`, "http://localhost:3000"),
    { method: "GET", headers: { Authorization: "Bearer t" } }
  );
  return { req, context: { params: Promise.resolve({ id }) } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mongoConfigured = true;
  grantTable = {};
  mockGetAuth.mockResolvedValue({ session: { sub: "admin-sub" } });
  mockRequireUserProfileRead.mockResolvedValue(undefined);
  mockGetRealmUserById.mockResolvedValue({
    id: "user-1",
    email: "Dev@Example.com",
  });
  mockAgentsFind.mockResolvedValue([
    { _id: "agent-github", name: "GitHub agent" },
    { _id: "agent-jira", name: "Jira agent" },
  ]);
  mockListOpenFgaObjects.mockImplementation(
    async ({ user, relation, type }: { user: string; relation: string; type: string }) => ({
      objects: grantTable[grantKey(user, relation, type)] ?? [],
    }),
  );
});

describe("GET /api/admin/users/[id]/access", () => {
  it("aggregates access from active team memberships with team-based reasons", async () => {
    mockMembershipFind.mockResolvedValue([
      { team_slug: "platform", relationship: "admin" },
    ]);
    mockTeamsFind.mockResolvedValue([
      { _id: "t1", slug: "platform", name: "Platform" },
    ]);
    grantTable = {
      [grantKey("team:platform#member", "user", "agent")]: ["agent:agent-github"],
      [grantKey("team:platform#admin", "manager", "agent")]: ["agent:agent-jira"],
      [grantKey("team:platform#member", "caller", "tool")]: ["tool:jira/*"],
      [grantKey("team:platform#member", "user", "skill")]: ["skill:skill-summarize"],
      [grantKey("team:platform#member", "reader", "knowledge_base")]: ["knowledge_base:kb-runbooks"],
    };

    const { GET } = await import("../route");
    const { req, context } = request("user-1");
    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(200);
    const { access } = body.data;
    // Sorted by display name: "GitHub agent" before "Jira agent".
    expect(access.agents).toEqual([
      expect.objectContaining({ id: "agent-github", name: "GitHub agent", capability: "use" }),
      expect.objectContaining({ id: "agent-jira", name: "Jira agent", capability: "manage" }),
    ]);
    expect(access.tools[0]).toMatchObject({ id: "jira/*", capability: "call" });
    expect(access.knowledge_bases[0]).toMatchObject({ id: "kb-runbooks", capability: "read" });
    expect(access.skills[0]).toMatchObject({ id: "skill-summarize", capability: "use" });
    // The "why" is the granting team.
    expect(access.agents[0].via).toEqual([
      { kind: "team", team_slug: "platform", team_name: "Platform", role: "admin" },
    ]);
  });

  it("reads KB access from OpenFGA grants with per-KB permissions", async () => {
    mockMembershipFind.mockResolvedValue([
      { team_slug: "platform", relationship: "admin" },
    ]);
    mockTeamsFind.mockResolvedValue([
      { _id: "t1", slug: "platform", name: "Platform" },
    ]);
    // kb-runbooks via `member ingestor` (→ ingest), kb-secrets via `admin
    // manager` (→ admin). The strongest-permission merge in listTeamKbGrants
    // surfaces each at its granted level.
    grantTable = {
      [grantKey("team:platform#member", "ingestor", "knowledge_base")]: ["knowledge_base:kb-runbooks"],
      [grantKey("team:platform#admin", "manager", "knowledge_base")]: ["knowledge_base:kb-secrets"],
    };

    const { GET } = await import("../route");
    const { req, context } = request("user-1");
    const res = await GET(req, context);
    const body = await res.json();

    const kbs = body.data.access.knowledge_bases.map(
      (k: { id: string; capability: string }) => `${k.id}:${k.capability}`
    );
    expect(kbs).toContain("kb-runbooks:ingest");
    // Admin sees the admin-level KB grant too.
    expect(kbs).toContain("kb-secrets:admin");
  });

  it("hides admin-level KB grants from a plain member", async () => {
    mockMembershipFind.mockResolvedValue([
      { team_slug: "platform", relationship: "member" },
    ]);
    mockTeamsFind.mockResolvedValue([
      { _id: "t1", slug: "platform", name: "Platform" },
    ]);
    // The team holds both a member reader grant and an admin manager grant.
    // listTeamKbGrants surfaces both objects; the route's role gate must drop
    // the admin-level grant for a plain member (roleSatisfies), so kb-secrets
    // never reaches the response even though the tuple exists.
    grantTable = {
      [grantKey("team:platform#member", "reader", "knowledge_base")]: ["knowledge_base:kb-runbooks"],
      [grantKey("team:platform#admin", "manager", "knowledge_base")]: ["knowledge_base:kb-secrets"],
    };

    const { GET } = await import("../route");
    const { req, context } = request("user-1");
    const res = await GET(req, context);
    const body = await res.json();

    const kbs = body.data.access.knowledge_bases.map(
      (k: { id: string; capability: string }) => `${k.id}:${k.capability}`
    );
    expect(kbs).toContain("kb-runbooks:read");
    expect(kbs).not.toContain("kb-secrets:admin");
  });

  it("does not grant agent manage to a plain member", async () => {
    mockMembershipFind.mockResolvedValue([
      { team_slug: "platform", relationship: "member" },
    ]);
    mockTeamsFind.mockResolvedValue([
      { _id: "t1", slug: "platform", name: "Platform" },
    ]);
    grantTable = {
      [grantKey("team:platform#member", "user", "agent")]: ["agent:agent-github"],
      [grantKey("team:platform#admin", "manager", "agent")]: ["agent:agent-jira"],
    };

    const { GET } = await import("../route");
    const { req, context } = request("user-1");
    const res = await GET(req, context);
    const body = await res.json();

    const caps = body.data.access.agents.map(
      (a: { id: string; capability: string }) => `${a.id}:${a.capability}`
    );
    expect(caps).toContain("agent-github:use");
    expect(caps).not.toContain("agent-jira:manage");
  });

  it("merges a resource granted by two teams into one item with two reasons", async () => {
    mockMembershipFind.mockResolvedValue([
      { team_slug: "platform", relationship: "member" },
      { team_slug: "payments", relationship: "member" },
    ]);
    mockTeamsFind.mockResolvedValue([
      { _id: "t1", slug: "platform", name: "Platform" },
      { _id: "t2", slug: "payments", name: "Payments" },
    ]);
    grantTable = {
      [grantKey("team:platform#member", "user", "agent")]: ["agent:agent-github"],
      [grantKey("team:payments#member", "user", "agent")]: ["agent:agent-github"],
    };

    const { GET } = await import("../route");
    const { req, context } = request("user-1");
    const res = await GET(req, context);
    const body = await res.json();

    expect(body.data.access.agents).toHaveLength(1);
    expect(body.data.access.agents[0].via.map((v: { team_slug: string }) => v.team_slug)).toEqual(
      expect.arrayContaining(["platform", "payments"])
    );
  });

  it("surfaces personally-owned (non-team) resources with kind: owned", async () => {
    // No team memberships — only owner-direct grants keyed on the subject.
    mockMembershipFind.mockResolvedValue([]);
    grantTable = {
      [grantKey("user:user-1", "owner", "agent")]: ["agent:agent-github"],
      [grantKey("user:user-1", "owner", "skill")]: ["skill:my-skill"],
      [grantKey("user:user-1", "owner", "task")]: ["task:my-workflow"],
    };

    const { GET } = await import("../route");
    const { req, context } = request("user-1");
    const res = await GET(req, context);
    const body = await res.json();

    const { access } = body.data;
    // Owner implies manage for agents, use for skills/workflows.
    expect(access.agents[0]).toMatchObject({ id: "agent-github", capability: "manage" });
    expect(access.agents[0].via).toEqual([
      { kind: "owned", team_slug: "", team_name: "", role: "admin" },
    ]);
    expect(access.skills[0]).toMatchObject({ id: "my-skill", capability: "use" });
    expect(access.workflows[0]).toMatchObject({ id: "my-workflow", capability: "use" });
    expect(access.workflows[0].via[0].kind).toBe("owned");
  });

  it("surfaces the tool:* wildcard sentinel as an all-tools item", async () => {
    mockMembershipFind.mockResolvedValue([
      { team_slug: "platform", relationship: "member" },
    ]);
    mockTeamsFind.mockResolvedValue([
      { _id: "t1", slug: "platform", name: "Platform" },
    ]);
    grantTable = {
      [grantKey("team:platform#member", "caller", "tool")]: ["tool:*"],
    };

    const { GET } = await import("../route");
    const { req, context } = request("user-1");
    const res = await GET(req, context);
    const body = await res.json();

    expect(body.data.access.tools[0]).toMatchObject({
      id: "*",
      name: "All MCP tools",
    });
  });

  it("returns empty access for a user with no memberships", async () => {
    mockMembershipFind.mockResolvedValue([]);

    const { GET } = await import("../route");
    const { req, context } = request("user-1");
    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.access).toEqual({
      agents: [],
      tools: [],
      knowledge_bases: [],
      skills: [],
      workflows: [],
    });
    expect(mockTeamsFind).not.toHaveBeenCalled();
  });

  it("returns empty access when the user has no email", async () => {
    mockGetRealmUserById.mockResolvedValue({ id: "user-1", email: "" });

    const { GET } = await import("../route");
    const { req, context } = request("user-1");
    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.teams).toEqual([]);
    expect(mockMembershipFind).not.toHaveBeenCalled();
  });

  it("returns 503 when MongoDB is not configured", async () => {
    mongoConfigured = false;

    const { GET } = await import("../route");
    const { req, context } = request("user-1");
    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe("MONGODB_NOT_CONFIGURED");
  });
});
