/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckPermission = jest.fn();
const mockCheckUniversalRebacRelationship = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();

const mockCollections: Record<string, any> = {};

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkUniversalRebacRelationship: (...args: unknown[]) =>
    mockCheckUniversalRebacRelationship(...args),
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
const channelId = "C123456789";
const agentGrant = {
  resource: { type: "agent", id: "incident-agent" },
  actions: ["use"],
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockCheckUniversalRebacRelationship.mockResolvedValue({ allowed: true });
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

describe("Slack channel ReBAC APIs", () => {
  it("lists configured Slack channels with active grant counts", async () => {
    mockCollections.slack_channel_grants = createMockCollection([
      { workspace_id: workspaceId, channel_id: channelId, status: "active", resource: agentGrant.resource },
    ]);
    const { GET } = await import("../route");

    const response = await GET(request("/api/admin/slack/channels"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.channels).toEqual([
      expect.objectContaining({
        workspace_id: workspaceId,
        channel_id: channelId,
        channel_name: "incidents",
        active_grants: 1,
      }),
    ]);
  });

  it("replaces channel resource grants and writes channel OpenFGA tuples", async () => {
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
        workspace_id: workspaceId,
        channel_id: channelId,
        "resource.type": "agent",
        "resource.id": "incident-agent",
      },
      expect.objectContaining({ $set: expect.objectContaining({ status: "active" }) }),
      { upsert: true }
    );
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: `slack_channel:${workspaceId}--${channelId}`, relation: "can_use", object: "agent:incident-agent" }],
      deletes: [],
    });
  });

  it("checks both channel grants and user resource grants", async () => {
    mockCollections.slack_channel_grants = createMockCollection([
      {
        workspace_id: workspaceId,
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
    expect(mockCheckUniversalRebacRelationship).toHaveBeenCalledTimes(1);
    expect(mockCheckUniversalRebacRelationship).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { type: "team", id: "platform-engineering", relation: "member" },
        action: "use",
      })
    );
  });
});
