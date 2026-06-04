/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockGetCollection = jest.fn();
const mockConnectToDatabase = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockGetKeycloakRbacDiagnosticValues = jest.fn();

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
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  getKeycloakRbacDiagnosticValues: (...args: unknown[]) =>
    mockGetKeycloakRbacDiagnosticValues(...args),
}));

type TestRow = Record<string, unknown>;
type TestUpdate = { $set?: TestRow; $setOnInsert?: TestRow };

function createCollection(rows: TestRow[] = []) {
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
    updateOne: jest.fn(async (filter: Record<string, unknown>, update: TestUpdate) => {
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
  process.env.BOOTSTRAP_ADMIN_EMAILS = "admin@example.com";
  process.env.KEYCLOAK_URL = "http://keycloak";
  process.env.KEYCLOAK_REALM = "caipe";
  for (const key of Object.keys(collections)) delete collections[key];
  mockGetAuthFromBearerOrSession.mockResolvedValue({
    user: { email: "admin@example.com", name: "Admin" },
    session: { sub: "admin-sub", role: "admin", user: { email: "admin@example.com" } },
  });
  mockRequireRbacPermission.mockResolvedValue(undefined);
  mockRequireResourcePermission.mockResolvedValue(undefined);
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
  mockGetCollection.mockImplementation(async (name: string) => collections[name] ?? createCollection());
  mockConnectToDatabase.mockImplementation(async () => ({
    db: {
      listCollections: jest.fn(() => ({
        toArray: jest.fn(async () => Object.keys(collections).map((name) => ({ name }))),
      })),
    },
  }));

  collections.conversations = createCollection([
    { _id: "c1", owner_id: "alice@example.com", metadata: {} },
    { _id: "c2", owner_id: "missing@example.com", metadata: {} },
  ]);
  collections.users = createCollection([{ email: "alice@example.com", keycloak_sub: "alice-sub" }]);
  collections.schema_migrations = createCollection();
  collections.data_schema_versions = createCollection();
  collections.migration_manifest = createCollection();
  collections.migration_overrides = createCollection();
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
  collections.slack_channel_grants = createCollection([
    {
      workspace_id: "T123",
      channel_id: "C123",
      resource: { type: "agent", id: "agent-1" },
      actions: ["use"],
      source_type: "manual",
      status: "active",
    },
  ]);
  collections.slack_channel_agent_routes = createCollection([
    {
      workspace_id: "T123",
      channel_id: "C124",
      agent_id: "agent-1",
      enabled: true,
      status: "active",
    },
  ]);
  collections.webex_space_grants = createCollection([
    {
      workspace_id: "WEBEX",
      space_id: "space-1",
      resource: { type: "knowledge_base", id: "kb-1" },
      actions: ["read"],
      source_type: "manual",
      status: "active",
    },
  ]);
  collections.webex_space_agent_routes = createCollection([
    {
      workspace_id: "WEBEX",
      space_id: "space-2",
      agent_id: "agent-1",
      enabled: true,
      status: "active",
    },
  ]);
  collections.channel_team_mappings = createCollection([
    {
      slack_workspace_id: "T123",
      slack_channel_id: "C123",
      channel_name: "incidents",
      team_id: "team-1",
      team_slug: "platform",
      status: "active",
    },
  ]);
  collections.webex_space_team_mappings = createCollection([
    {
      workspace_id: "WEBEX",
      space_id: "space-1",
      space_name: "War Room",
      team_id: "team-1",
      team_slug: "platform",
      status: "active",
    },
  ]);
});

describe("admin ReBAC migrations API", () => {
  it("seeds a DB-managed manifest and hides completed migrations by default", async () => {
    collections.schema_migrations = createCollection([
      { _id: "conversation_owner_identity_v1", release: "0.5.1", status: "completed", completed_at: "2026-05-19T12:00:00.000Z" },
    ]);
    collections.data_schema_versions = createCollection([
      { _id: "conversations", version: 2, last_migration_id: "conversation_owner_identity_v1" },
      { _id: "team_resources", version: 1 },
    ]);
    const { GET } = await import("../migrations/route");

    const response = await GET(request("/api/admin/rebac/migrations"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(collections.migration_manifest.updateOne).toHaveBeenCalledWith(
      { _id: "conversation_owner_identity_v1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          migration_id: "conversation_owner_identity_v1",
          release: "0.5.1",
          schema_area: "conversations",
          from_version: 1,
          to_version: 2,
          blocking: true,
        }),
      }),
      { upsert: true },
    );
    expect(body.data.migrations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "conversation_owner_identity_v1" }),
      ]),
    );
    expect(body.data.completed_migrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "conversation_owner_identity_v1",
          status: "completed",
          current_version: 2,
        }),
      ]),
    );
    expect(body.data.schema_versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ schema_area: "conversations", current_version: 2, target_version: 2, status: "current" }),
        expect.objectContaining({ schema_area: "team_resources", current_version: 1, target_version: 2, status: "behind" }),
      ]),
    );
  });

  it("returns blocking migration status and records super-admin overrides", async () => {
    collections.data_schema_versions = createCollection([{ _id: "conversations", version: 1 }]);
    const statusRoute = await import("../migrations/status/route");
    const overrideRoute = await import("../migrations/override/route");

    const statusResponse = await statusRoute.GET(request("/api/admin/rebac/migrations/status"));
    const statusBody = await statusResponse.json();

    expect(statusResponse.status).toBe(200);
    expect(statusBody.data.pending_required_count).toBeGreaterThan(0);
    expect(statusBody.data.blocking_required_count).toBeGreaterThan(0);
    expect(statusBody.data.is_blocking).toBe(true);
    expect(statusBody.data.runtime).toEqual(
      expect.objectContaining({
        // The runtime reports the latest active release; the 0.5.8 manifest
        // adds the unified shareable-resource RBAC backfills.
        migration_release: "0.5.8",
      }),
    );

    const overrideResponse = await overrideRoute.POST(
      request("/api/admin/rebac/migrations/override", {
        method: "POST",
        body: JSON.stringify({ reason: "Emergency production verification" }),
      }),
    );
    const overrideBody = await overrideResponse.json();

    expect(overrideResponse.status).toBe(200);
    expect(overrideBody.data.override_active).toBe(true);
    expect(collections.migration_overrides.updateOne).toHaveBeenCalledWith(
      { _id: "0.5.8:admin@example.com" },
      expect.objectContaining({
        $set: expect.objectContaining({
          release: "0.5.8",
          reason: "Emergency production verification",
          status: "active",
          created_by: "admin@example.com",
        }),
      }),
      { upsert: true },
    );
  });

  it("includes unversioned schema areas in migration status so admins get a runtime warning", async () => {
    collections.messages = createCollection();
    collections.feedback = createCollection();
    collections.data_schema_versions = createCollection([
      { _id: "conversations", version: 2, last_migration_id: "conversation_owner_identity_v1" },
    ]);
    const statusRoute = await import("../migrations/status/route");

    const statusResponse = await statusRoute.GET(request("/api/admin/rebac/migrations/status"));
    const statusBody = await statusResponse.json();

    expect(statusResponse.status).toBe(200);
    expect(statusBody.data.needs_version_bootstrap).toBe(true);
    expect(statusBody.data.version_bootstrap_required_count).toBeGreaterThanOrEqual(2);
    expect(statusBody.data.version_bootstrap_schema_areas).toEqual(
      expect.arrayContaining(["messages", "feedback"]),
    );
    expect(statusBody.data.requires_attention).toBe(true);
  });

  it("returns Keycloak migration health with persisted run details", async () => {
    collections.schema_migrations = createCollection([
      {
        _id: "keycloak_rbac_mapping_reconciliation_v1",
        release: "0.5.1",
        schema_area: "keycloak_rbac_mappings",
        status: "failed",
        applied_counts: {
          team_scopes_reconciled: 2,
          obo_permission_sets_reconciled: 1,
        },
        warnings: ["Keycloak unavailable"],
        error: "Keycloak unavailable",
        updated_by: "webui-startup",
        updated_at: "2026-05-19T12:00:00.000Z",
        bootstrap_admins: {
          enabled: true,
          configured_emails: ["admin@cisco.com"],
          resolved_count: 1,
          created_count: 0,
          failed_count: 0,
          tuple_write_count: 3,
          warnings: [],
          outcomes: [
            {
              email: "admin@cisco.com",
              user_id: "sub-admin",
              status: "existing",
              tuple_write_count: 3,
            },
          ],
        },
      },
    ]);
    collections.data_schema_versions = createCollection([
      {
        _id: "keycloak_rbac_mappings",
        version: 0,
        last_migration_id: "keycloak_rbac_mapping_reconciliation_v1",
      },
    ]);
    mockGetKeycloakRbacDiagnosticValues.mockRejectedValueOnce(new TypeError("fetch failed"));
    const { GET } = await import("../../keycloak/migration-health/route");

    const response = await GET(request("/api/admin/keycloak/migration-health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.keycloak).toEqual(
      expect.objectContaining({
        configured: true,
        reachable: false,
        realm: "caipe",
      }),
    );
    expect(body.data.schema_area).toEqual(
      expect.objectContaining({
        area: "keycloak_rbac_mappings",
        current_version: 0,
        target_version: 1,
        status: "behind",
      }),
    );
    expect(body.data.migration.last_run).toEqual(
      expect.objectContaining({
        status: "failed",
        actor: "webui-startup",
        applied_counts: expect.objectContaining({ team_scopes_reconciled: 2 }),
        warnings: ["Keycloak unavailable"],
        error: "Keycloak unavailable",
      }),
    );
    expect(body.data.bootstrap_admins).toEqual(
      expect.objectContaining({
        enabled: true,
        resolved_count: 1,
        tuple_write_count: 3,
        outcomes: [
          expect.objectContaining({
            email: "admin@cisco.com",
            user_id: "sub-admin",
          }),
        ],
      }),
    );
    expect(body.data.blocking.is_blocking).toBe(true);
  });

  it("lists 0.5.1 migrations with stored schema status", async () => {
    mockRequireResourcePermission.mockRejectedValue(new Error("system_config denied"));
    collections.messages = createCollection();
    collections.data_schema_versions = createCollection([
      { _id: "conversations", version: 1, last_migration_id: "legacy" },
      { _id: "messages", version: 3, last_migration_id: "message-history-v3" },
    ]);
    const { GET } = await import("../migrations/route");

    const response = await GET(request("/api/admin/rebac/migrations"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    // Latest active release (the 0.5.8 manifest adds the shareable-resource
    // RBAC backfills on top of the 0.5.1 entries).
    expect(body.data.release).toBe("0.5.8");
    expect(body.data.migrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "conversation_owner_identity_v1",
          kind: "implicit",
          current_version: 1,
          target_version: 2,
        }),
        expect.objectContaining({
          id: "slack_channel_rebac_backfill_v1",
          title: "Slack channel ReBAC grants",
        }),
        expect.objectContaining({
          id: "webex_space_rebac_backfill_v1",
          title: "Webex space ReBAC grants",
        }),
        expect.objectContaining({
          id: "messaging_team_mapping_reconciliation_v1",
          title: "Messaging team mapping reconciliation",
        }),
        expect.objectContaining({
          id: "messaging_rebac_indexes_v1",
          title: "Messaging ReBAC indexes",
        }),
      ]),
    );
    expect(body.data.schema_versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema_area: "messages",
          current_version: 3,
          target_version: null,
          status: "current",
        }),
        expect.objectContaining({
          schema_area: "users",
          current_version: null,
          target_version: null,
          status: "unknown",
        }),
      ]),
    );
  });

  it("initializes selected unversioned schema areas to v1 without touching collection documents", async () => {
    collections.messages = createCollection();
    collections.feedback = createCollection();
    collections.data_schema_versions = createCollection([
      { _id: "conversations", version: 2, last_migration_id: "conversation_owner_identity_v1" },
    ]);
    const { POST } = await import("../migrations/version-bootstrap/apply/route");

    const response = await POST(
      request("/api/admin/rebac/migrations/version-bootstrap/apply", {
        method: "POST",
        body: JSON.stringify({
          schema_areas: ["messages", "feedback"],
          confirmation: "INITIALIZE SCHEMA VERSIONS TO v1",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.applied_counts).toMatchObject({
      schema_versions_initialized: 2,
      collection_documents_touched: 0,
    });
    expect(collections.messages.updateOne).not.toHaveBeenCalled();
    expect(collections.feedback.updateOne).not.toHaveBeenCalled();
    expect(collections.data_schema_versions.updateOne).toHaveBeenCalledWith(
      { _id: "messages" },
      expect.objectContaining({
        $set: expect.objectContaining({
          version: 1,
          last_migration_id: "schema_version_bootstrap_v1",
          updated_by: "admin@example.com",
        }),
      }),
      { upsert: true },
    );
    expect(collections.data_schema_versions.updateOne).toHaveBeenCalledWith(
      { _id: "feedback" },
      expect.objectContaining({
        $set: expect.objectContaining({
          version: 1,
          last_migration_id: "schema_version_bootstrap_v1",
        }),
      }),
      { upsert: true },
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

  it("plans and applies Slack channel ReBAC grant backfill", async () => {
    const planRoute = await import("../migrations/[migrationId]/plan/route");
    const applyRoute = await import("../migrations/[migrationId]/apply/route");

    const planResponse = await planRoute.POST(
      request("/api/admin/rebac/migrations/slack_channel_rebac_backfill_v1/plan", { method: "POST" }),
      { params: Promise.resolve({ migrationId: "slack_channel_rebac_backfill_v1" }) },
    );
    const planBody = await planResponse.json();

    expect(planResponse.status).toBe(200);
    expect(planBody.data.counts).toMatchObject({
      grants_scanned: 1,
      routes_scanned: 1,
      tuples_planned: 2,
      relationships_planned: 2,
    });
    expect(planBody.data.confirmation).toBe("MIGRATE slack_channel_rebac TO v2");

    const applyResponse = await applyRoute.POST(
      request("/api/admin/rebac/migrations/slack_channel_rebac_backfill_v1/apply", {
        method: "POST",
        body: JSON.stringify({ confirmation: "MIGRATE slack_channel_rebac TO v2" }),
      }),
      { params: Promise.resolve({ migrationId: "slack_channel_rebac_backfill_v1" }) },
    );

    expect(applyResponse.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        { user: "slack_channel:T123--C123", relation: "user", object: "agent:agent-1" },
        { user: "slack_channel:T123--C124", relation: "user", object: "agent:agent-1" },
      ]),
      deletes: [],
    });
    expect(collections.rebac_relationships.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        "subject.type": "slack_channel",
        "subject.id": "T123--C123",
        action: "use",
        "resource.type": "agent",
        "resource.id": "agent-1",
        source_id: "slack_channel_rebac_backfill_v1",
      }),
      expect.any(Object),
      { upsert: true },
    );
  });

  it("plans and applies Webex space ReBAC grant backfill", async () => {
    const planRoute = await import("../migrations/[migrationId]/plan/route");
    const applyRoute = await import("../migrations/[migrationId]/apply/route");

    const planResponse = await planRoute.POST(
      request("/api/admin/rebac/migrations/webex_space_rebac_backfill_v1/plan", { method: "POST" }),
      { params: Promise.resolve({ migrationId: "webex_space_rebac_backfill_v1" }) },
    );
    const planBody = await planResponse.json();

    expect(planResponse.status).toBe(200);
    expect(planBody.data.counts).toMatchObject({
      grants_scanned: 1,
      routes_scanned: 1,
      tuples_planned: 2,
      relationships_planned: 2,
    });

    const applyResponse = await applyRoute.POST(
      request("/api/admin/rebac/migrations/webex_space_rebac_backfill_v1/apply", {
        method: "POST",
        body: JSON.stringify({ confirmation: "MIGRATE webex_space_rebac TO v2" }),
      }),
      { params: Promise.resolve({ migrationId: "webex_space_rebac_backfill_v1" }) },
    );

    expect(applyResponse.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        { user: "webex_space:WEBEX--space-1", relation: "reader", object: "knowledge_base:kb-1" },
        { user: "webex_space:WEBEX--space-2", relation: "user", object: "agent:agent-1" },
      ]),
      deletes: [],
    });
  });

  it("applies messaging team mapping reconciliation and messaging indexes", async () => {
    const applyRoute = await import("../migrations/[migrationId]/apply/route");

    const mappingResponse = await applyRoute.POST(
      request("/api/admin/rebac/migrations/messaging_team_mapping_reconciliation_v1/apply", {
        method: "POST",
        body: JSON.stringify({ confirmation: "MIGRATE messaging_team_mappings TO v2" }),
      }),
      { params: Promise.resolve({ migrationId: "messaging_team_mapping_reconciliation_v1" }) },
    );
    const mappingBody = await mappingResponse.json();

    expect(mappingResponse.status).toBe(200);
    expect(collections.teams.updateOne).toHaveBeenCalledWith(
      { _id: "team-1" },
      expect.objectContaining({
        $addToSet: expect.objectContaining({
          slack_channels: expect.objectContaining({
            slack_channel_id: "C123",
            channel_name: "incidents",
            slack_workspace_id: "T123",
          }),
        }),
      }),
    );
    expect(collections.teams.updateOne).toHaveBeenCalledWith(
      { _id: "team-1" },
      expect.objectContaining({
        $addToSet: expect.objectContaining({
          webex_spaces: expect.objectContaining({
            space_id: "space-1",
            space_name: "War Room",
            workspace_id: "WEBEX",
          }),
        }),
      }),
    );
    expect(mappingBody.data.applied_counts.messaging_team_mappings_reconciled).toBe(2);

    const indexResponse = await applyRoute.POST(
      request("/api/admin/rebac/migrations/messaging_rebac_indexes_v1/apply", {
        method: "POST",
        body: JSON.stringify({ confirmation: "MIGRATE messaging_rebac_indexes TO v2" }),
      }),
      { params: Promise.resolve({ migrationId: "messaging_rebac_indexes_v1" }) },
    );
    const indexBody = await indexResponse.json();

    expect(indexResponse.status).toBe(200);
    expect(collections.webex_space_grants.createIndex).toHaveBeenCalled();
    expect(collections.webex_space_agent_routes.createIndex).toHaveBeenCalled();
    expect(collections.webex_space_team_mappings.createIndex).toHaveBeenCalled();
    expect(indexBody.data.applied_counts.indexes_created).toBeGreaterThan(0);
  });
});
