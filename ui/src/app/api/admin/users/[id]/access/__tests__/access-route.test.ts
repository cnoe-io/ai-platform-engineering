/**
 * @jest-environment node
 *
 * Tests for GET /api/admin/users/[id]/access — the read-only "what can this
 * user reach, and which team granted it?" view that replaced the low-level
 * Permissions Tool.
 *
 * Covers:
 *  - aggregates agents/tools/skills/tasks/KBs from the user's active teams;
 *  - admin role unlocks agent_admins (manage) and members do not;
 *  - the same resource granted by two teams merges into one item with two
 *    `via` entries;
 *  - tool_wildcard surfaces an "all tools" item;
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
const mockKbOwnershipFind = jest.fn();

let mongoConfigured = true;

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
    if (name === "team_kb_ownership") {
      return { find: (...a: unknown[]) => ({ toArray: () => mockKbOwnershipFind(...a) }) };
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
  mockKbOwnershipFind.mockResolvedValue([]);
});

describe("GET /api/admin/users/[id]/access", () => {
  it("aggregates access from active team memberships with team-based reasons", async () => {
    mockMembershipFind.mockResolvedValue([
      { team_slug: "platform", relationship: "admin" },
    ]);
    mockTeamsFind.mockResolvedValue([
      {
        _id: "t1",
        slug: "platform",
        name: "Platform",
        resources: {
          agents: ["agent-github"],
          agent_admins: ["agent-jira"],
          tools: ["jira_*"],
          knowledge_bases: ["kb-runbooks"],
          skills: ["skill-summarize"],
          tasks: [],
        },
      },
    ]);

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
    expect(access.tools[0]).toMatchObject({ id: "jira_*", capability: "call" });
    expect(access.knowledge_bases[0]).toMatchObject({ id: "kb-runbooks", capability: "read" });
    expect(access.skills[0]).toMatchObject({ id: "skill-summarize", capability: "use" });
    // The "why" is the granting team.
    expect(access.agents[0].via).toEqual([
      { team_slug: "platform", team_name: "Platform", role: "admin" },
    ]);
  });

  it("reads KB access from team_kb_ownership with per-KB permissions", async () => {
    mockMembershipFind.mockResolvedValue([
      { team_slug: "platform", relationship: "admin" },
    ]);
    mockTeamsFind.mockResolvedValue([
      { _id: "t1", slug: "platform", name: "Platform", resources: {} },
    ]);
    mockKbOwnershipFind.mockResolvedValue([
      {
        team_id: "t1",
        kb_ids: ["kb-runbooks", "kb-secrets"],
        kb_permissions: { "kb-runbooks": "ingest", "kb-secrets": "admin" },
      },
    ]);

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
      { _id: "t1", slug: "platform", name: "Platform", resources: {} },
    ]);
    mockKbOwnershipFind.mockResolvedValue([
      {
        team_id: "t1",
        kb_ids: ["kb-runbooks", "kb-secrets"],
        kb_permissions: { "kb-runbooks": "read", "kb-secrets": "admin" },
      },
    ]);

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

  it("does not grant agent_admins (manage) to a plain member", async () => {
    mockMembershipFind.mockResolvedValue([
      { team_slug: "platform", relationship: "member" },
    ]);
    mockTeamsFind.mockResolvedValue([
      {
        _id: "t1",
        slug: "platform",
        name: "Platform",
        resources: { agents: ["agent-github"], agent_admins: ["agent-jira"] },
      },
    ]);

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
      { _id: "t1", slug: "platform", name: "Platform", resources: { agents: ["agent-github"] } },
      { _id: "t2", slug: "payments", name: "Payments", resources: { agents: ["agent-github"] } },
    ]);

    const { GET } = await import("../route");
    const { req, context } = request("user-1");
    const res = await GET(req, context);
    const body = await res.json();

    expect(body.data.access.agents).toHaveLength(1);
    expect(body.data.access.agents[0].via.map((v: { team_slug: string }) => v.team_slug)).toEqual(
      expect.arrayContaining(["platform", "payments"])
    );
  });

  it("surfaces tool_wildcard as an all-tools item", async () => {
    mockMembershipFind.mockResolvedValue([
      { team_slug: "platform", relationship: "member" },
    ]);
    mockTeamsFind.mockResolvedValue([
      { _id: "t1", slug: "platform", name: "Platform", resources: { tool_wildcard: true } },
    ]);

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
      tasks: [],
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
