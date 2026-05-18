/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockGetCollection = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();

const collections: Record<string, ReturnType<typeof createCollection>> = {};

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public statusCode = 500,
      public code?: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    successResponse: (data: unknown, status = 200) => Response.json({ success: true, data }, { status }),
    withErrorHandler:
      <T,>(handler: (request: NextRequest, context?: unknown) => Promise<T>) =>
      async (request: NextRequest, context?: unknown) => {
        try {
          return await handler(request, context);
        } catch (error) {
          return Response.json(
            {
              success: false,
              error: error instanceof Error ? error.message : "error",
              code: (error as { code?: string }).code,
            },
            { status: (error as { statusCode?: number }).statusCode ?? 500 },
          );
        }
      },
  };
});

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

function createCollection(rows: any[] = []) {
  return {
    rows,
    find: jest.fn(() => ({
      project: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn(async () => rows),
    })),
    findOne: jest.fn(async (filter?: Record<string, unknown>) => {
      if (!filter || Object.keys(filter).length === 0) return rows[0] ?? null;
      return rows.find((row) => Object.entries(filter).every(([key, value]) => row[key] === value)) ?? null;
    }),
    updateOne: jest.fn(async (filter: Record<string, unknown>, update: Record<string, any>) => {
      const row = rows.find((candidate) => Object.entries(filter).every(([key, value]) => candidate[key] === value));
      if (row && update.$set) Object.assign(row, update.$set);
      if (!row && update.$setOnInsert) rows.push({ ...filter, ...update.$setOnInsert, ...update.$set });
      return { acknowledged: true, matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
    }),
    createIndex: jest.fn(async () => "idx"),
  };
}

function request(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(collections)) delete collections[key];
  mockGetAuthFromBearerOrSession.mockResolvedValue({
    user: { email: "admin@example.com", name: "Admin" },
    session: { sub: "admin-sub", role: "admin", user: { email: "admin@example.com" } },
  });
  mockRequireRbacPermission.mockResolvedValue(undefined);
  mockRequireResourcePermission.mockResolvedValue(undefined);
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
  mockGetCollection.mockImplementation(async (name: string) => collections[name] ?? createCollection());

  collections.conversations = createCollection([
    { _id: "c1", owner_id: "alice@example.com", metadata: {} },
    { _id: "c2", owner_id: "missing@example.com", metadata: {} },
  ]);
  collections.users = createCollection([{ email: "alice@example.com", keycloak_sub: "alice-sub" }]);
  collections.schema_migrations = createCollection();
  collections.data_schema_versions = createCollection();
  collections.teams = createCollection([
    {
      _id: "team-1",
      slug: "platform",
      members: [{ user_id: "alice@example.com", role: "member" }],
      resources: { agents: ["agent-1"], tools: ["github/*"], knowledge_bases: ["kb-1"] },
    },
  ]);
  collections.team_membership_sources = createCollection();
  collections.dynamic_agents = createCollection([
    { _id: "agent-1", allowed_tools: { github: ["search", "issues"] } },
  ]);
  collections.platform_config = createCollection([{ _id: "platform_settings", default_agent_id: "agent-1" }]);
  collections.rebac_relationships = createCollection();
});

describe("admin ReBAC migrations API", () => {
  it("lists 0.5.1 migrations with stored schema status", async () => {
    mockRequireResourcePermission.mockRejectedValue(new Error("system_config denied"));
    collections.data_schema_versions = createCollection([
      { _id: "conversations", version: 1, last_migration_id: "legacy" },
    ]);
    const { GET } = await import("../migrations/route");

    const response = await GET(request("/api/admin/rebac/migrations"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    expect(body.data.release).toBe("0.5.1");
    expect(body.data.migrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "conversation_owner_identity_v1",
          kind: "implicit",
          current_version: 1,
          target_version: 2,
        }),
      ]),
    );
  });

  it("plans conversation owner identity migration without applying writes", async () => {
    mockRequireResourcePermission.mockRejectedValue(new Error("system_config denied"));
    const { POST } = await import("../migrations/[migrationId]/plan/route");

    const response = await POST(
      request("/api/admin/rebac/migrations/conversation_owner_identity_v1/plan", { method: "POST" }),
      { params: Promise.resolve({ migrationId: "conversation_owner_identity_v1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    expect(body.data.counts).toMatchObject({
      total_conversations: 2,
      resolvable: 1,
      unresolved: 1,
      tuple_writes_planned: 0,
    });
    expect(collections.conversations.updateOne).not.toHaveBeenCalled();
  });

  it("requires typed confirmation before applying migration", async () => {
    const { POST } = await import("../migrations/[migrationId]/apply/route");

    const response = await POST(
      request("/api/admin/rebac/migrations/conversation_owner_identity_v1/apply", {
        method: "POST",
        body: JSON.stringify({ confirmation: "wrong" }),
      }),
      { params: Promise.resolve({ migrationId: "conversation_owner_identity_v1" }) },
    );

    expect(response.status).toBe(400);
    expect(collections.conversations.updateOne).not.toHaveBeenCalled();
  });

  it("applies conversation owner identity migration and records schema version", async () => {
    const { POST } = await import("../migrations/[migrationId]/apply/route");

    const response = await POST(
      request("/api/admin/rebac/migrations/conversation_owner_identity_v1/apply", {
        method: "POST",
        body: JSON.stringify({ confirmation: "MIGRATE conversations TO v2" }),
      }),
      { params: Promise.resolve({ migrationId: "conversation_owner_identity_v1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.applied_counts).toMatchObject({
      conversations_updated: 1,
      tuple_writes_applied: 0,
    });
    expect(collections.conversations.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "c1" }),
      expect.objectContaining({
        $set: expect.objectContaining({
          owner_subject: "alice-sub",
          owner_identity_version: 2,
        }),
      }),
    );
    expect(collections.schema_migrations.updateOne).toHaveBeenCalled();
    expect(collections.data_schema_versions.updateOne).toHaveBeenCalledWith(
      { _id: "conversations" },
      expect.objectContaining({
        $set: expect.objectContaining({
          version: 2,
          last_migration_id: "conversation_owner_identity_v1",
        }),
      }),
      { upsert: true },
    );
  });

  it("plans registered universal ReBAC migration with concrete tuple counts", async () => {
    const { POST } = await import("../migrations/[migrationId]/plan/route");

    const response = await POST(
      request("/api/admin/rebac/migrations/universal_rebac_relationship_backfill_v1/plan", { method: "POST" }),
      { params: Promise.resolve({ migrationId: "universal_rebac_relationship_backfill_v1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.counts).toMatchObject({
      teams_scanned: 1,
      tuples_planned: expect.any(Number),
      relationships_planned: expect.any(Number),
    });
    expect(body.data.counts.not_implemented).toBeUndefined();
    expect(body.data.tuple_writes_planned).toBeGreaterThan(0);
  });

  it("applies registered universal ReBAC migration", async () => {
    const { POST } = await import("../migrations/[migrationId]/apply/route");

    const response = await POST(
      request("/api/admin/rebac/migrations/universal_rebac_relationship_backfill_v1/apply", {
        method: "POST",
        body: JSON.stringify({ confirmation: "MIGRATE team_resources TO v2" }),
      }),
      { params: Promise.resolve({ migrationId: "universal_rebac_relationship_backfill_v1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        { user: "user:alice-sub", relation: "member", object: "team:platform" },
        { user: "team:platform#member", relation: "user", object: "agent:agent-1" },
        { user: "user:*", relation: "user", object: "agent:agent-1" },
      ]),
      deletes: [],
    });
    expect(collections.rebac_relationships.updateOne).toHaveBeenCalled();
    expect(collections.team_membership_sources.updateOne).toHaveBeenCalled();
    expect(body.data.applied_counts).toMatchObject({
      tuple_writes_applied: 1,
      relationships_upserted: expect.any(Number),
      membership_sources_upserted: expect.any(Number),
    });
  });

  it("applies registered dynamic agent tool tuple migration", async () => {
    const { POST } = await import("../migrations/[migrationId]/apply/route");

    const response = await POST(
      request("/api/admin/rebac/migrations/agent_tool_openfga_backfill_v1/apply", {
        method: "POST",
        body: JSON.stringify({ confirmation: "MIGRATE dynamic_agents TO v2" }),
      }),
      { params: Promise.resolve({ migrationId: "agent_tool_openfga_backfill_v1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        { user: "agent:agent-1", relation: "caller", object: "tool:github/search" },
        { user: "agent:agent-1", relation: "caller", object: "tool:github/issues" },
      ]),
      deletes: [],
    });
    expect(body.data.applied_counts).toMatchObject({ tuple_writes_applied: 1 });
    expect(collections.data_schema_versions.updateOne).toHaveBeenCalledWith(
      { _id: "dynamic_agents" },
      expect.objectContaining({
        $set: expect.objectContaining({
          version: 2,
          last_migration_id: "agent_tool_openfga_backfill_v1",
        }),
      }),
      { upsert: true },
    );
  });

  it("applies registered RBAC index migration", async () => {
    collections.schema_migrations = createCollection();
    collections.data_schema_versions = createCollection();
    const { POST } = await import("../migrations/[migrationId]/apply/route");

    const response = await POST(
      request("/api/admin/rebac/migrations/rbac_indexes_v1/apply", {
        method: "POST",
        body: JSON.stringify({ confirmation: "MIGRATE audit_events TO v2" }),
      }),
      { params: Promise.resolve({ migrationId: "rbac_indexes_v1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(collections.schema_migrations.createIndex).toHaveBeenCalled();
    expect(collections.schema_migrations.createIndex).not.toHaveBeenCalledWith(
      { _id: 1 },
      expect.objectContaining({ unique: true }),
    );
    expect(collections.data_schema_versions.createIndex).not.toHaveBeenCalledWith(
      { _id: 1 },
      expect.objectContaining({ unique: true }),
    );
    expect(body.data.applied_counts.indexes_created).toBeGreaterThan(0);
  });
});
