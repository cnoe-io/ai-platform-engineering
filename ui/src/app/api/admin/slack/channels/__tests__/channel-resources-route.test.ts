/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckPermission = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockCheckUniversalRebacRelationship = jest.fn();
const mockReadOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();

const mockCollections: Record<string, any> = {};

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
  checkUniversalRebacRelationship: (...args: unknown[]) =>
    mockCheckUniversalRebacRelationship(...args),
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
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

function matchesFilter(row: any, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object" && "$ne" in value) return row[key] !== value.$ne;
    if (value && typeof value === "object" && "$in" in value) return value.$in.includes(row[key]);
    if (value && typeof value === "object" && "$nin" in value) return !value.$nin.includes(row[key]);
    if (key.includes(".")) {
      const resolved = key.split(".").reduce((acc, part) => acc?.[part], row);
      return resolved === value;
    }
    return row[key] === value;
  });
}

function createMockCollection(rows: any[]) {
  return {
    rows,
    find: jest.fn((filter: Record<string, any> = {}) => {
      const matching = rows.filter((row) => matchesFilter(row, filter));
      return {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(matching),
      };
    }),
    findOne: jest.fn(async (filter: Record<string, any>) =>
      rows.find((row) => matchesFilter(row, filter)) ?? null
    ),
    updateOne: jest.fn(async (filter: Record<string, any>, update: any, options?: any) => {
      const row = rows.find((candidate) => matchesFilter(candidate, filter));
      if (row && update.$set) Object.assign(row, update.$set);
      if (!row && options?.upsert) rows.push({ ...filter, ...(update.$set ?? {}) });
      return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0, upsertedCount: row ? 0 : 1 };
    }),
    updateMany: jest.fn(async (filter: Record<string, any>, update: any) => {
      const matching = rows.filter((candidate) => matchesFilter(candidate, filter));
      for (const row of matching) {
        if (update.$set) Object.assign(row, update.$set);
      }
      return { matchedCount: matching.length, modifiedCount: matching.length };
    }),
    deleteOne: jest.fn(async (filter: Record<string, any>) => {
      const index = rows.findIndex((candidate) => matchesFilter(candidate, filter));
      if (index >= 0) {
        rows.splice(index, 1);
      }
      return { deletedCount: index >= 0 ? 1 : 0 };
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

const workspaceId = "T123456789";
const workspaceAlias = "CAIPE";
const channelId = "C123456789";
const agentGrant = {
  resource: { type: "agent", id: "incident-agent" },
  actions: ["use"],
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SLACK_WORKSPACE_ALIAS = workspaceAlias;
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
  mockCheckUniversalRebacRelationship.mockResolvedValue({ allowed: true });
  mockReadOpenFgaTuples.mockResolvedValue({ tuples: [], continuationToken: undefined });
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
  mockCollections.channel_team_mappings = createMockCollection([
    {
      slack_workspace_id: workspaceId,
      slack_channel_id: channelId,
      channel_name: "incidents",
      team_slug: "platform-engineering",
      active: true,
    },
  ]);
  mockCollections.slack_channel_grants = createMockCollection([]);
});

afterEach(() => {
  delete process.env.SLACK_WORKSPACE_ALIAS;
});

describe("Slack channel ReBAC APIs", () => {
  it("lists configured Slack channels with active grant counts", async () => {
    mockCollections.slack_channel_grants = createMockCollection([
      { workspace_id: workspaceAlias, channel_id: channelId, status: "active", resource: agentGrant.resource },
    ]);
    const { GET } = await import("../route");

    const response = await GET(request("/api/admin/slack/channels"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.channels).toEqual([
      expect.objectContaining({
        workspace_id: workspaceAlias,
        channel_id: channelId,
        channel_name: "incidents",
        active_grants: 1,
      }),
    ]);
  });

  it("replaces channel resource grants and writes channel OpenFGA tuples", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({
      tuples: [
        {
          key: {
            user: `slack_channel:${workspaceAlias}--${channelId}`,
            relation: "user",
            object: "agent:stale-agent",
          },
        },
      ],
    });
    const { PUT } = await import("../[workspaceId]/[channelId]/resources/route");

    const response = await PUT(
      request(`/api/admin/slack/channels/${workspaceId}/${channelId}/resources`, {
        method: "PUT",
        body: JSON.stringify({ grants: [agentGrant] }),
      }),
      { params: Promise.resolve({ workspaceId, channelId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.grants).toHaveLength(1);
    expect(mockCollections.slack_channel_grants.updateOne).toHaveBeenCalledWith(
      {
        workspace_id: workspaceAlias,
        channel_id: channelId,
        "resource.type": "agent",
        "resource.id": "incident-agent",
      },
      expect.objectContaining({ $set: expect.objectContaining({ status: "active" }) }),
      { upsert: true }
    );
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: `slack_channel:${workspaceAlias}--${channelId}`, relation: "user", object: "agent:incident-agent" }],
      deletes: [{ user: `slack_channel:${workspaceAlias}--${channelId}`, relation: "user", object: "agent:stale-agent" }],
    });
  });

  it("checks both channel grants and user resource grants", async () => {
    mockCollections.slack_channel_grants = createMockCollection([
      {
        workspace_id: workspaceAlias,
        channel_id: channelId,
        resource: { type: "agent", id: "incident-agent" },
        actions: ["use"],
        status: "active",
      },
    ]);
    mockCheckUniversalRebacRelationship
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: true });
    const { POST } = await import("../[workspaceId]/[channelId]/access-check/route");

    const response = await POST(
      request(`/api/admin/slack/channels/${workspaceId}/${channelId}/access-check`, {
        method: "POST",
        body: JSON.stringify({
          user_subject: "team:platform-engineering#member",
          resource: { type: "agent", id: "incident-agent" },
          action: "use",
        }),
      }),
      { params: Promise.resolve({ workspaceId, channelId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      allowed: true,
      channel_allowed: true,
      user_allowed: true,
      reason: "allowed",
    });
    expect(mockCheckUniversalRebacRelationship).toHaveBeenCalledTimes(2);
    expect(mockCheckUniversalRebacRelationship).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { type: "slack_channel", id: `${workspaceAlias}--${channelId}` },
        action: "use",
        resource: { type: "agent", id: "incident-agent" },
      })
    );
    expect(mockCheckUniversalRebacRelationship).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { type: "team", id: "platform-engineering", relation: "member" },
        action: "use",
      })
    );
  });

  it("denies Slack access when the OpenFGA channel tuple was removed", async () => {
    mockCollections.slack_channel_grants = createMockCollection([
      {
        workspace_id: workspaceAlias,
        channel_id: channelId,
        resource: { type: "agent", id: "incident-agent" },
        actions: ["use"],
        status: "active",
      },
    ]);
    mockCheckUniversalRebacRelationship.mockResolvedValueOnce({ allowed: false });
    const { POST } = await import("../[workspaceId]/[channelId]/access-check/route");

    const response = await POST(
      request(`/api/admin/slack/channels/${workspaceId}/${channelId}/access-check`, {
        method: "POST",
        body: JSON.stringify({
          user_subject: "team:platform-engineering#member",
          resource: { type: "agent", id: "incident-agent" },
          action: "use",
        }),
      }),
      { params: Promise.resolve({ workspaceId, channelId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      allowed: false,
      channel_allowed: false,
      user_allowed: false,
      reason: "missing_channel_grant",
    });
    expect(mockCheckUniversalRebacRelationship).toHaveBeenCalledTimes(1);
    expect(mockCheckUniversalRebacRelationship).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { type: "slack_channel", id: `${workspaceAlias}--${channelId}` },
        action: "use",
        resource: { type: "agent", id: "incident-agent" },
      })
    );
  });

  it("saving Slack agent routes writes OpenFGA tuples and route metadata", async () => {
    mockCollections.slack_channel_agent_routes = createMockCollection([]);
    mockReadOpenFgaTuples.mockResolvedValue({
      tuples: [
        {
          key: {
            user: `slack_channel:${workspaceAlias}--${channelId}`,
            relation: "user",
            object: "agent:stale-agent",
          },
        },
      ],
    });
    const { PUT } = await import("../[workspaceId]/[channelId]/routes/route");

    const response = await PUT(
      request(`/api/admin/slack/channels/${workspaceId}/${channelId}/routes`, {
        method: "PUT",
        body: JSON.stringify({
          routes: [
            {
              agent_id: "incident-agent",
              enabled: true,
              priority: 10,
              users: { enabled: true, listen: "mention" },
            },
          ],
        }),
      }),
      { params: Promise.resolve({ workspaceId, channelId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.routes).toHaveLength(1);
    expect(mockCollections.slack_channel_agent_routes.updateOne).toHaveBeenCalledWith(
      {
        workspace_id: workspaceAlias,
        channel_id: channelId,
        agent_id: "incident-agent",
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "active",
          priority: 10,
          users: { enabled: true, listen: "mention" },
        }),
      }),
      { upsert: true }
    );
    expect(mockCollections.slack_channel_grants.updateOne).not.toHaveBeenCalled();
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [
        {
          user: `slack_channel:${workspaceAlias}--${channelId}`,
          relation: "user",
          object: "agent:incident-agent",
        },
      ],
      deletes: [
        {
          user: `slack_channel:${workspaceAlias}--${channelId}`,
          relation: "user",
          object: "agent:stale-agent",
        },
      ],
    });
  });

  it("fails route saves when OpenFGA reconciliation fails", async () => {
    mockCollections.slack_channel_agent_routes = createMockCollection([]);
    mockWriteOpenFgaTuples.mockRejectedValue(new Error("OpenFGA down"));
    const { PUT } = await import("../[workspaceId]/[channelId]/routes/route");

    const response = await PUT(
      request(`/api/admin/slack/channels/${workspaceId}/${channelId}/routes`, {
        method: "PUT",
        body: JSON.stringify({
          routes: [{ agent_id: "incident-agent", enabled: true }],
        }),
      }),
      { params: Promise.resolve({ workspaceId, channelId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(JSON.stringify(body)).toMatch(/OpenFGA tuple write failed/i);
  });

  it("lists only OpenFGA-backed route associations and joins saved metadata", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({
      tuples: [
        {
          key: {
            user: `slack_channel:${workspaceAlias}--${channelId}`,
            relation: "user",
            object: "agent:incident-agent",
          },
        },
      ],
    });
    mockCollections.slack_channel_agent_routes = createMockCollection([
      {
        workspace_id: workspaceAlias,
        channel_id: channelId,
        agent_id: "incident-agent",
        enabled: true,
        priority: 25,
        status: "active",
        users: { enabled: true, listen: "message" },
      },
      {
        workspace_id: workspaceAlias,
        channel_id: channelId,
        agent_id: "stale-mongo-agent",
        enabled: true,
        priority: 1,
        status: "active",
        users: { enabled: true, listen: "mention" },
      },
    ]);
    const { GET } = await import("../[workspaceId]/[channelId]/routes/route");

    const response = await GET(
      request(`/api/admin/slack/channels/${workspaceId}/${channelId}/routes`),
      { params: Promise.resolve({ workspaceId, channelId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.routes).toEqual([
      expect.objectContaining({
        agent_id: "incident-agent",
        priority: 25,
        users: { enabled: true, listen: "message" },
      }),
    ]);
    expect(mockReadOpenFgaTuples).toHaveBeenCalledWith({
      pageSize: 100,
    });
  });

  it("reports Slack runtime diagnostics for tuple-backed routes and stale metadata", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({
      tuples: [
        {
          key: {
            user: `slack_channel:${workspaceAlias}--${channelId}`,
            relation: "user",
            object: "agent:incident-agent",
          },
        },
      ],
    });
    mockCollections.slack_channel_agent_routes = createMockCollection([
      {
        workspace_id: workspaceAlias,
        channel_id: channelId,
        agent_id: "incident-agent",
        enabled: true,
        priority: 25,
        status: "active",
        users: { enabled: true, listen: "mention" },
      },
      {
        workspace_id: workspaceAlias,
        channel_id: channelId,
        agent_id: "stale-mongo-agent",
        enabled: true,
        priority: 1,
        status: "active",
        users: { enabled: true, listen: "message" },
      },
    ]);
    mockCollections.audit_events = createMockCollection([
      {
        type: "slack_runtime",
        component: "slack_bot",
        outcome: "error",
        action: "slack.route",
        resource_ref: `slack_channel:${workspaceAlias}--${channelId}`,
        reason_code: "OPENFGA_READ_FAILED",
        message: "OpenFGA tuple read failed",
        ts: "2026-05-18T07:50:00.000Z",
      },
    ]);
    const { GET } = await import("../[workspaceId]/[channelId]/diagnostics/route");

    const response = await GET(
      request(`/api/admin/slack/channels/${workspaceId}/${channelId}/diagnostics`),
      { params: Promise.resolve({ workspaceId, channelId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      openfga: { reachable: true, tuple_count: 1 },
      routes: [
        expect.objectContaining({
          agent_id: "incident-agent",
          openfga_tuple: true,
          route_metadata: true,
          listen: "mention",
          runtime_matches: { mention: true, message: false },
        }),
        expect.objectContaining({
          agent_id: "stale-mongo-agent",
          openfga_tuple: false,
          route_metadata: true,
        }),
      ],
      last_runtime_error: expect.objectContaining({
        reason_code: "OPENFGA_READ_FAILED",
      }),
    });
    expect(body.data.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Plain channel messages will be ignored/i),
        expect.stringMatching(/stale-mongo-agent.*OpenFGA tuple is missing/i),
      ])
    );
  });

  it("reports OpenFGA read failures in Slack runtime diagnostics", async () => {
    mockReadOpenFgaTuples.mockRejectedValue(new Error("OpenFGA tuple read failed: 400"));
    mockCollections.slack_channel_agent_routes = createMockCollection([
      {
        workspace_id: workspaceAlias,
        channel_id: channelId,
        agent_id: "incident-agent",
        enabled: true,
        priority: 25,
        status: "active",
        users: { enabled: true, listen: "mention" },
      },
    ]);
    const { GET } = await import("../[workspaceId]/[channelId]/diagnostics/route");

    const response = await GET(
      request(`/api/admin/slack/channels/${workspaceId}/${channelId}/diagnostics`),
      { params: Promise.resolve({ workspaceId, channelId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.openfga).toMatchObject({
      reachable: false,
      error: "OpenFGA tuple read failed: 400",
    });
    expect(body.data.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/Slack bot cannot read OpenFGA tuples/i)])
    );
  });

  it("deletes Slack agent associations from OpenFGA and dependent Mongo route metadata", async () => {
    mockCollections.slack_channel_agent_routes = createMockCollection([
      {
        workspace_id: workspaceAlias,
        channel_id: channelId,
        agent_id: "incident-agent",
        enabled: true,
        priority: 25,
        status: "active",
        users: { enabled: true, listen: "message" },
      },
    ]);
    const { DELETE } = await import("../[workspaceId]/[channelId]/routes/route");

    const response = await DELETE(
      request(`/api/admin/slack/channels/${workspaceId}/${channelId}/routes`, {
        method: "DELETE",
        body: JSON.stringify({ agent_id: "incident-agent" }),
      }),
      { params: Promise.resolve({ workspaceId, channelId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.deleted).toEqual({
      agent_id: "incident-agent",
      route_metadata_deleted: true,
    });
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [],
      deletes: [
        {
          user: `slack_channel:${workspaceAlias}--${channelId}`,
          relation: "user",
          object: "agent:incident-agent",
        },
      ],
    });
    expect(mockCollections.slack_channel_agent_routes.deleteOne).toHaveBeenCalledWith({
      workspace_id: workspaceAlias,
      channel_id: channelId,
      agent_id: "incident-agent",
    });
  });

  it("applies migration defaults to Slack channels and default team", async () => {
    mockCollections.channel_team_mappings = createMockCollection([
      {
        slack_workspace_id: workspaceId,
        slack_channel_id: channelId,
        channel_name: "incidents",
        active: true,
      },
      {
        slack_workspace_id: workspaceId,
        slack_channel_id: "C987654321",
        channel_name: "platform",
        team_slug: "existing-team",
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
    mockCollections.slack_channel_agent_routes = createMockCollection([]);
    const { POST } = await import("../defaults/route");

    const response = await POST(
      request("/api/admin/slack/channels/defaults", {
        method: "POST",
        body: JSON.stringify({
          team_slug: "platform-engineering",
          agent_id: "incident-agent",
          create_routes: true,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.summary).toMatchObject({
      channels_seen: 2,
      channels_assigned_team: 1,
      channel_grants_ensured: 2,
      routes_ensured: 2,
      team_grant_ensured: true,
    });
    expect(mockCollections.channel_team_mappings.updateOne).toHaveBeenCalledWith(
      { slack_channel_id: channelId },
      expect.objectContaining({
        $set: expect.objectContaining({
          team_id: "team-1",
          team_slug: "platform-engineering",
          updated_by: "api",
        }),
      })
    );
    expect(mockCollections.teams.updateOne).toHaveBeenCalledWith(
      { _id: "team-1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          resources: expect.objectContaining({ agents: ["incident-agent"] }),
        }),
      })
    );
    expect(mockCollections.slack_channel_grants.updateOne).toHaveBeenCalledWith(
      {
        workspace_id: workspaceAlias,
        channel_id: channelId,
        "resource.type": "agent",
        "resource.id": "incident-agent",
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          source_type: "migration",
          status: "active",
        }),
      }),
      { upsert: true }
    );
    expect(mockCollections.slack_channel_agent_routes.updateOne).toHaveBeenCalledWith(
      {
        workspace_id: workspaceAlias,
        channel_id: channelId,
        agent_id: "incident-agent",
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          source_type: "bootstrap",
          status: "active",
          users: { enabled: true, listen: "mention" },
        }),
      }),
      { upsert: true }
    );
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        { user: `slack_channel:${workspaceAlias}--${channelId}`, relation: "user", object: "agent:incident-agent" },
        { user: `slack_channel:${workspaceAlias}--C987654321`, relation: "user", object: "agent:incident-agent" },
        { user: "team:platform-engineering#member", relation: "user", object: "agent:incident-agent" },
      ]),
      deletes: [],
    });
  });
});
