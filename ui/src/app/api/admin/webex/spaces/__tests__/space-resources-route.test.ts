/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import { RBAC_COLLECTION_NAMES } from "@/lib/rbac/mongo-collections";

const mockCheckPermission = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockCheckUniversalRebacRelationship = jest.fn();
const mockReadOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockDeleteExactOpenFgaTuples = jest.fn();
const mockAuditQuery = jest.fn();
// Phase 3 (spec 2026-05-24-derive-team-from-channel): the Webex
// space onboarding flow no longer calls `ensureTeamClientScope` or
// `selectAgentGatewayActiveTeamScope` — team identity is derived
// from the channel→team mapping at message time, not from a
// per-team Keycloak client scope. Those mocks have been removed
// below.
const mockEnsureWebexBotOboPermissions = jest.fn();
// (See the Phase 3 comment above the removed mockEnsureTeamClientScope declaration.)
const mockCallWebexBotAdmin = jest.fn();

const mockCollections: Record<string, ReturnType<typeof createMockCollection>> = {};

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
  checkUniversalRebacRelationship: (...args: unknown[]) =>
    mockCheckUniversalRebacRelationship(...args),
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
  deleteExactOpenFgaTuples: (...args: unknown[]) => mockDeleteExactOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: jest.fn(
    async (
      session: { sub?: string; isServiceAccount?: boolean },
      target: { type: string; id: string; action: string },
      options?: { bypassForOrgAdmin?: boolean }
    ) => {
      const prefix = session?.isServiceAccount === true ? "service_account" : "user";
      const user = `${prefix}:${session?.sub ?? ""}`;
      if (options?.bypassForOrgAdmin) {
        const org = await mockCheckOpenFgaTuple({
          user,
          relation: "can_manage",
          object: "organization:caipe",
        });
        if (org.allowed === true) return;
      }
      const relation = target.action === "manage" ? "can_manage" : `can_${target.action}`;
      const result = await mockCheckOpenFgaTuple({
        user,
        relation,
        object: `${target.type}:${target.id}`,
      });
      if (result.allowed === true) return;
      const error = new Error("You do not have permission to access this resource.") as Error & {
        statusCode: number;
        code: string;
      };
      error.statusCode = 403;
      error.code = `${target.type}#${target.action}`;
      throw error;
    }
  ),
  subjectFromSession: jest.fn((session: { sub?: string; isServiceAccount?: boolean }) => {
    if (!session?.sub) return null;
    return `${session.isServiceAccount === true ? "service_account" : "user"}:${session.sub}`;
  }),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  ensureWebexBotOboPermissions: (...args: unknown[]) => mockEnsureWebexBotOboPermissions(...args),
  isValidTeamSlug: (slug: string) => /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug),
}));

jest.mock("@/lib/webex-bot-admin", () => ({
  callWebexBotAdmin: (...args: unknown[]) => mockCallWebexBotAdmin(...args),
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "alice-sub",
    email: "alice@example.com",
    name: "Alice Admin",
  })),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) => mockCollections[name] ?? createMockCollection([])),
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/audit/reader", () => ({
  getAuditReader: () => ({ query: (...args: unknown[]) => mockAuditQuery(...args) }),
}));

jest.mock("@/lib/rbac/mongo-collections", () => {
  const actual = jest.requireActual("@/lib/rbac/mongo-collections");
  return {
    ...actual,
    getRbacCollection: jest.fn(async (key: keyof typeof actual.RBAC_COLLECTION_NAMES) => {
      const name = actual.RBAC_COLLECTION_NAMES[key];
      return mockCollections[name] ?? createMockCollection([]);
    }),
  };
});

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

function matchesFilter(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object" && "$ne" in (value as object)) {
      return row[key] !== (value as { $ne: unknown }).$ne;
    }
    if (value && typeof value === "object" && "$in" in (value as object)) {
      return (value as { $in: unknown[] }).$in.includes(row[key]);
    }
    if (value && typeof value === "object" && "$nin" in (value as object)) {
      return !(value as { $nin: unknown[] }).$nin.includes(row[key]);
    }
    if (key.includes(".")) {
      const resolved = key.split(".").reduce<unknown>((acc, part) => {
        if (acc && typeof acc === "object") {
          return (acc as Record<string, unknown>)[part];
        }
        return undefined;
      }, row);
      return resolved === value;
    }
    return row[key] === value;
  });
}

function createMockCollection(rows: Record<string, unknown>[]) {
  return {
    rows,
    find: jest.fn((filter: Record<string, unknown> = {}) => {
      const matching = rows.filter((row) => matchesFilter(row, filter));
      return {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(matching),
      };
    }),
    findOne: jest.fn(async (filter: Record<string, unknown>) =>
      rows.find((row) => matchesFilter(row, filter)) ?? null
    ),
    updateOne: jest.fn(
      async (
        filter: Record<string, unknown>,
        update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
        options?: { upsert?: boolean }
      ) => {
        const row = rows.find((candidate) => matchesFilter(candidate, filter));
        if (row && update.$set) Object.assign(row, update.$set);
        if (!row && options?.upsert) {
          rows.push({ ...filter, ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) });
        }
        return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0, upsertedCount: row ? 0 : 1 };
      }
    ),
    updateMany: jest.fn(async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const matching = rows.filter((candidate) => matchesFilter(candidate, filter));
      for (const row of matching) {
        if (update.$set) Object.assign(row, update.$set);
      }
      return { matchedCount: matching.length, modifiedCount: matching.length };
    }),
    deleteOne: jest.fn(async (filter: Record<string, unknown>) => {
      const index = rows.findIndex((candidate) => matchesFilter(candidate, filter));
      if (index >= 0) rows.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    }),
    deleteMany: jest.fn(async (filter: Record<string, unknown>) => {
      const matching = rows.filter((candidate) => matchesFilter(candidate, filter));
      for (const row of matching) rows.splice(rows.indexOf(row), 1);
      return { deletedCount: matching.length };
    }),
  };
}

function request(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    ...init,
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

const workspaceId = "org-123";
const workspaceAlias = "CAIPE-WEBEX";
const spaceId = "space-abc";
const agentGrant = {
  resource: { type: "agent", id: "incident-agent" },
  actions: ["use"],
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENFGA_HTTP = "http://openfga:8080";
  process.env.WEBEX_WORKSPACE_ALIAS = workspaceAlias;
  process.env.WEBEX_INTEGRATION_BOTS_JSON = JSON.stringify([
    { id: "primary", name: "Primary", tokenEnv: "WEBEX_PRIMARY_BOT_TOKEN" },
  ]);
  process.env.WEBEX_PRIMARY_BOT_TOKEN = "bot-token";
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockAuditQuery.mockResolvedValue([]);
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
  mockCheckUniversalRebacRelationship.mockResolvedValue({ allowed: true });
  mockReadOpenFgaTuples.mockResolvedValue({ tuples: [], continuationToken: undefined });
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
  mockDeleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, deletes: 0 });
  // Phase 3 (spec 2026-05-24-derive-team-from-channel): no team
  // client-scope mock to reset — the helper is gone.
  mockEnsureWebexBotOboPermissions.mockResolvedValue(undefined);
  mockCallWebexBotAdmin.mockResolvedValue({ reloaded: "space" });
  mockCollections[RBAC_COLLECTION_NAMES.webexSpaceGrants] = createMockCollection([]);
});

afterEach(() => {
  delete process.env.OPENFGA_HTTP;
  delete process.env.WEBEX_WORKSPACE_ALIAS;
  delete process.env.WEBEX_INTEGRATION_BOTS_JSON;
  delete process.env.WEBEX_PRIMARY_BOT_TOKEN;
});

describe("Webex space ReBAC resource APIs", () => {
  it("filters the Webex space list to concrete spaces the caller can read or manage", async () => {
    mockCollections[RBAC_COLLECTION_NAMES.webexSpaceTeamMappings] = createMockCollection([
      {
        bot_id: "primary",
        webex_workspace_id: workspaceId,
        webex_space_id: spaceId,
        space_name: "Incident Room",
        active: true,
      },
      {
        bot_id: "primary",
        webex_workspace_id: workspaceId,
        webex_space_id: "space-private",
        space_name: "Private Leadership",
        active: true,
      },
    ]);
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { relation: string; object: string }) => ({
      allowed:
        tuple.object === `webex_space:${workspaceAlias}--${spaceId}` &&
        (tuple.relation === "can_read" || tuple.relation === "can_manage"),
    }));
    const { GET } = await import("../route");

    const response = await GET(request("/api/admin/webex/spaces?bot_id=primary"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.spaces).toEqual([
      expect.objectContaining({
        space_id: spaceId,
        space_name: "Incident Room",
        can_manage: true,
      }),
    ]);
  });

  it("scopes a View As space list to the simulated user", async () => {
    mockCollections[RBAC_COLLECTION_NAMES.webexSpaceTeamMappings] = createMockCollection([
      {
        bot_id: "primary",
        webex_workspace_id: workspaceId,
        webex_space_id: spaceId,
        space_name: "Incident Room",
        active: true,
      },
      {
        bot_id: "primary",
        webex_workspace_id: workspaceId,
        webex_space_id: "space-private",
        space_name: "Private Leadership",
        active: true,
      },
    ]);
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: {
      user: string;
      relation: string;
      object: string;
    }) => ({
      allowed:
        (tuple.user === "user:alice-sub" &&
          tuple.relation === "can_manage" &&
          tuple.object === "organization:caipe") ||
        (tuple.user === "user:target-sub" &&
          tuple.relation === "can_read" &&
          tuple.object === `webex_space:${workspaceAlias}--${spaceId}`),
    }));
    const { GET } = await import("../route");

    const response = await GET(
      request(
        "/api/admin/webex/spaces?bot_id=primary&simulate_type=user&simulate_id=target-sub"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.spaces).toEqual([
      expect.objectContaining({
        space_id: spaceId,
        space_name: "Incident Room",
        can_manage: false,
      }),
    ]);
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledWith({
      user: "user:target-sub",
      relation: "can_read",
      object: `webex_space:${workspaceAlias}--${spaceId}`,
    });
  });

  it("rejects View As space scoping for a non-admin caller", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    const { GET } = await import("../route");

    const response = await GET(
      request(
        "/api/admin/webex/spaces?bot_id=primary&simulate_type=user&simulate_id=target-sub"
      )
    );

    expect(response.status).toBe(403);
  });

  it("requires team-owned Webex space manage authorization for PUT and does not write tuples", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    const { PUT } = await import("../[workspaceId]/[spaceId]/resources/route");

    const response = await PUT(
      request(`/api/admin/webex/spaces/${workspaceId}/${spaceId}/resources`, {
        method: "PUT",
        body: JSON.stringify({ grants: [agentGrant] }),
      }),
      { params: Promise.resolve({ workspaceId, spaceId }) }
    );

    expect(response.status).toBe(403);
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledWith({
      user: "user:alice-sub",
      relation: "can_manage",
      object: `webex_space:${workspaceAlias}--${spaceId}`,
    });
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
    expect(mockCollections[RBAC_COLLECTION_NAMES.webexSpaceGrants].updateOne).not.toHaveBeenCalled();
  });

  it("rejects unsupported grant actions with 400", async () => {
    const { PUT } = await import("../[workspaceId]/[spaceId]/resources/route");

    const response = await PUT(
      request(`/api/admin/webex/spaces/${workspaceId}/${spaceId}/resources`, {
        method: "PUT",
        body: JSON.stringify({
          grants: [{ resource: { type: "agent", id: "incident-agent" }, actions: ["not-a-real-action"] }],
        }),
      }),
      { params: Promise.resolve({ workspaceId, spaceId }) }
    );

    expect(response.status).toBe(400);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("replaces space resource grants and writes webex_space OpenFGA tuples with filtered reads", async () => {
    // Not an org admin (organization:caipe denied) so the per-space can_manage
    // check is what authorizes the actor — exercise that path explicitly.
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { relation: string; object: string }) => ({
      allowed: tuple.object === `webex_space:${workspaceAlias}--${spaceId}`,
    }));
    mockReadOpenFgaTuples.mockResolvedValue({
      tuples: [
        {
          key: {
            user: `webex_space:${workspaceAlias}--${spaceId}`,
            relation: "user",
            object: "agent:stale-agent",
          },
        },
      ],
    });
    const { PUT } = await import("../[workspaceId]/[spaceId]/resources/route");

    const response = await PUT(
      request(`/api/admin/webex/spaces/${workspaceId}/${spaceId}/resources`, {
        method: "PUT",
        body: JSON.stringify({ grants: [agentGrant] }),
      }),
      { params: Promise.resolve({ workspaceId, spaceId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledWith({
      user: "user:alice-sub",
      relation: "can_manage",
      object: `webex_space:${workspaceAlias}--${spaceId}`,
    });
    expect(body.data.grants).toHaveLength(1);
    expect(mockReadOpenFgaTuples).toHaveBeenCalledWith(
      expect.objectContaining({
        tuple: {
          user: `webex_space:${workspaceAlias}--${spaceId}`,
          relation: "user",
          object: "agent:",
        },
      })
    );
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [
        {
          user: `webex_space:${workspaceAlias}--${spaceId}`,
          relation: "user",
          object: "agent:incident-agent",
        },
      ],
      deletes: [
        {
          user: `webex_space:${workspaceAlias}--${spaceId}`,
          relation: "user",
          object: "agent:stale-agent",
        },
      ],
    });
  });

  it("requires admin authorization before applying Webex defaults", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    mockCheckPermission.mockResolvedValue({ allowed: false, reason: "denied" });
    const { POST } = await import("../defaults/route");

    const response = await POST(
      request("/api/admin/webex/spaces/defaults", {
        method: "POST",
        body: JSON.stringify({
          team_slug: "platform-engineering",
          agent_id: "incident-agent",
          create_routes: true,
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(mockCollections[RBAC_COLLECTION_NAMES.webexSpaceGrants].updateOne).not.toHaveBeenCalled();
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("onboards one Webex space by converging mapping grant route OpenFGA and runtime reload", async () => {
    const rawRoomId = "6f91b070-531a-11f1-926d-6fd3c20dfdc4";
    const publicRoomId =
      "Y2lzY29zcGFyazovL3VzL1JPT00vNmY5MWIwNzAtNTMxYS0xMWYxLTkyNmQtNmZkM2MyMGRmZGM0";
    mockCollections[RBAC_COLLECTION_NAMES.webexSpaceTeamMappings] = createMockCollection([]);
    mockCollections[RBAC_COLLECTION_NAMES.webexSpaceAgentRoutes] = createMockCollection([]);
    mockCollections.teams = createMockCollection([
      {
        _id: "team-1",
        slug: "platform",
        name: "Platform",
        resources: { agents: [] },
      },
    ]);
    mockCollections.dynamic_agents = createMockCollection([
      { _id: "agent-sri-demo-agent", name: "Sri Demo Agent", enabled: true },
    ]);
    const { POST } = await import("../onboard/route");

    const response = await POST(
      request("/api/admin/webex/spaces/onboard", {
        method: "POST",
        body: JSON.stringify({
          workspace_id: "Cisco",
          bot_id: "primary",
          space_id: publicRoomId,
          space_name: "Grid Test",
          team_slug: "platform",
          agent_id: "agent-sri-demo-agent",
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.summary).toMatchObject({
      spaces_seen: 1,
      mappings_ensured: 1,
      space_grants_ensured: 1,
      routes_ensured: 1,
      team_grant_ensured: true,
    });
    expect(body.data.space).toMatchObject({
      workspace_id: workspaceAlias,
      space_id: rawRoomId,
      webex_room_id: publicRoomId,
      team_slug: "platform",
      agent_id: "agent-sri-demo-agent",
      listen: "mention",
      bot_id: "primary",
    });
    // Phase 3 (spec 2026-05-24-derive-team-from-channel): the Webex
    // space onboarding flow no longer touches Keycloak team scopes,
    // so the `mockEnsureTeamClientScope` and
    // `mockSelectAgentGatewayActiveTeamScope` assertions were
    // removed with their helpers. OBO permissions are still wired up.
    expect(mockEnsureWebexBotOboPermissions).toHaveBeenCalled();
    expect(mockCollections[RBAC_COLLECTION_NAMES.webexSpaceTeamMappings].updateOne).toHaveBeenCalledWith(
      {
        bot_id: "primary",
        webex_workspace_id: workspaceAlias,
        webex_space_id: rawRoomId,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          space_name: "Grid Test",
          bot_id: "primary",
          team_id: "team-1",
          team_slug: "platform",
          active: true,
        }),
      }),
      { upsert: true }
    );
    expect(mockCollections[RBAC_COLLECTION_NAMES.webexSpaceAgentRoutes].updateOne).toHaveBeenCalledWith(
      {
        bot_id: "primary",
        workspace_id: workspaceAlias,
        space_id: rawRoomId,
        agent_id: "agent-sri-demo-agent",
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          users: { enabled: true, listen: "mention" },
          source_type: "bootstrap",
          status: "active",
        }),
      }),
      { upsert: true }
    );
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        {
          user: `webex_space:${workspaceAlias}--${rawRoomId}`,
          relation: "user",
          object: "agent:agent-sri-demo-agent",
        },
        {
          user: "team:platform#member",
          relation: "user",
          object: "agent:agent-sri-demo-agent",
        },
      ]),
      deletes: [],
    });
    expect(mockCallWebexBotAdmin).toHaveBeenCalledWith("/admin/webex/routes/reload", {
      method: "POST",
      body: {
        bot_id: "primary",
        workspace_id: workspaceAlias,
        space_id: rawRoomId,
      },
    });
  });

  it("rejects invalid manually entered Webex space ids", async () => {
    const { POST } = await import("../defaults/route");

    const response = await POST(
      request("/api/admin/webex/spaces/defaults", {
        method: "POST",
        body: JSON.stringify({
          team_slug: "platform-engineering",
          agent_id: "incident-agent",
          create_routes: true,
          manual_spaces: [{ id: "../bad", name: "Bad Space" }],
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mockCollections[RBAC_COLLECTION_NAMES.webexSpaceGrants].updateOne).not.toHaveBeenCalled();
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("onboards manually entered spaces before applying defaults without overwriting config-synced routes", async () => {
    mockCollections[RBAC_COLLECTION_NAMES.webexSpaceTeamMappings] = createMockCollection([
      {
        webex_workspace_id: workspaceAlias,
        webex_space_id: spaceId,
        space_name: "Platform Alerts",
        active: true,
      },
    ]);
    mockCollections.teams = createMockCollection([
      {
        _id: "team-1",
        slug: "platform-engineering",
        name: "Platform Engineering",
        resources: { agents: [] },
      },
    ]);
    mockCollections.dynamic_agents = createMockCollection([
      { _id: "incident-agent", name: "Incident Agent", enabled: true },
    ]);
    mockCollections[RBAC_COLLECTION_NAMES.webexSpaceAgentRoutes] = createMockCollection([
      {
        bot_id: "primary",
        workspace_id: workspaceAlias,
        space_id: "space-config-managed",
        agent_id: "incident-agent",
        enabled: true,
        priority: 25,
        users: { enabled: true, listen: "all" },
        source_type: "config_sync",
        status: "active",
      },
    ]);
    const { POST } = await import("../defaults/route");

    const response = await POST(
      request("/api/admin/webex/spaces/defaults", {
        method: "POST",
        body: JSON.stringify({
          team_slug: "platform-engineering",
          agent_id: "incident-agent",
          create_routes: true,
          manual_spaces: [
            { id: "space-config-managed", name: "Config Managed", bot_id: "primary" },
            { id: "space-new-manual", name: "Manual Escalations", bot_id: "primary" },
          ],
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.summary).toMatchObject({
      spaces_seen: 2,
      spaces_manual: 2,
      spaces_onboarded: 2,
      spaces_assigned_team: 2,
      space_grants_ensured: 2,
      routes_ensured: 1,
      routes_preserved: 1,
    });
    expect(mockCollections[RBAC_COLLECTION_NAMES.webexSpaceTeamMappings].updateOne).toHaveBeenCalledWith(
      {
        bot_id: "primary",
        webex_workspace_id: workspaceAlias,
        webex_space_id: "space-config-managed",
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          space_name: "Config Managed",
          active: true,
          webex_workspace_id: workspaceAlias,
          webex_space_id: "space-config-managed",
        }),
      }),
      { upsert: true }
    );
    expect(mockCollections[RBAC_COLLECTION_NAMES.webexSpaceAgentRoutes].updateOne).not.toHaveBeenCalledWith(
      {
        workspace_id: workspaceAlias,
        space_id: "space-config-managed",
        agent_id: "incident-agent",
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          priority: 100,
          users: { enabled: true, listen: "all" },
        }),
      }),
      { upsert: true }
    );
    expect(mockCollections[RBAC_COLLECTION_NAMES.webexSpaceAgentRoutes].updateOne).toHaveBeenCalledWith(
      {
        bot_id: "primary",
        workspace_id: workspaceAlias,
        space_id: "space-new-manual",
        agent_id: "incident-agent",
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          priority: 100,
          users: { enabled: true, listen: "mention" },
          source_type: "bootstrap",
        }),
      }),
      { upsert: true }
    );
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        {
          user: `webex_space:${workspaceAlias}--space-config-managed`,
          relation: "user",
          object: "agent:incident-agent",
        },
        { user: "team:platform-engineering#member", relation: "user", object: "agent:incident-agent" },
      ]),
      deletes: [],
    });
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        {
          user: `webex_space:${workspaceAlias}--space-new-manual`,
          relation: "user",
          object: "agent:incident-agent",
        },
        { user: "team:platform-engineering#member", relation: "user", object: "agent:incident-agent" },
      ]),
      deletes: [],
    });
  });

  it("suppresses stale Webex OpenFGA read runtime errors after live diagnostics succeeds", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({
      tuples: [
        {
          key: {
            user: `webex_space:${workspaceAlias}--${spaceId}`,
            relation: "user",
            object: "agent:incident-agent",
          },
        },
      ],
    });
    mockCollections[RBAC_COLLECTION_NAMES.webexSpaceAgentRoutes] = createMockCollection([
      {
        workspace_id: workspaceAlias,
        space_id: spaceId,
        bot_id: "primary",
        agent_id: "incident-agent",
        enabled: true,
        priority: 100,
        users: { enabled: true, listen: "all" },
        status: "active",
      },
    ]);
    mockAuditQuery.mockResolvedValue([
      {
        component: "webex_bot",
        outcome: "error",
        resource_ref: `webex_space:${workspaceAlias}--${spaceId}`,
        reason_code: "OPENFGA_READ_FAILED",
        message: "400 Client Error: Bad Request",
        ts: "2026-05-19T01:53:59.301557+00:00",
      },
    ]);
    const { GET } = await import("../[workspaceId]/[spaceId]/diagnostics/route");

    const response = await GET(
      request(`/api/admin/webex/spaces/${workspaceId}/${spaceId}/diagnostics?bot_id=primary`),
      { params: Promise.resolve({ workspaceId, spaceId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.openfga).toMatchObject({ reachable: true, tuple_count: 1 });
    expect(body.data.last_runtime_error).toBeNull();
  });
});
