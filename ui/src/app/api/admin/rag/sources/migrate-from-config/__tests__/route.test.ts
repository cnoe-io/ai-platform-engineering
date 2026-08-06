/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockGetCollection = jest.fn();
const mockCreateIngestionSource = jest.fn();
const mockDeleteAllDataSourceRelationshipTuples = jest.fn();
const mockDeleteAllIngestionSourceRelationshipTuples = jest.fn();
const mockDeleteAllKnowledgeBaseRelationshipTuples = jest.fn();
const mockReconcileDataSourceRelationships = jest.fn();
const mockReconcileIngestionSourceRelationships = jest.fn();
const mockReconcileKnowledgeBaseRelationships = jest.fn();
const mockEnsurePlatformRagCollection = jest.fn();
const mockAdoptConfigImportedRagSources = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockUpdateLegacyAgents = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: (...args: unknown[]) =>
      mockGetAuthFromBearerOrSession(...args),
    requireRbacPermission: (...args: unknown[]) =>
      mockRequireRbacPermission(...args),
    successResponse: (data: unknown) => Response.json({ success: true, data }),
    withErrorHandler:
      <T>(handler: (request: NextRequest) => Promise<T>) =>
      async (request: NextRequest) => {
        try {
          return await handler(request);
        } catch (err) {
          const { ApiError } = actual;
          if (err instanceof ApiError) {
            return Response.json(
              { success: false, error: err.message, code: err.code },
              { status: err.statusCode },
            );
          }
          throw err;
        }
      },
  };
});

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/authz", () => ({
  reconcileTupleDiff: (diff: unknown) => mockWriteOpenFgaTuples(diff),
}));

jest.mock("@/lib/rag-collections.server", () => ({
  ensurePlatformRagCollection: (...args: unknown[]) =>
    mockEnsurePlatformRagCollection(...args),
}));

jest.mock("@/lib/seed-config", () => ({
  adoptConfigImportedRagSources: (...args: unknown[]) =>
    mockAdoptConfigImportedRagSources(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) =>
    mockRequireResourcePermission(...args),
}));

jest.mock("@/lib/rbac/organization", () => ({
  caipeOrgKey: () => "example-org",
  organizationObjectId: () => "organization:example-org",
}));

jest.mock("@/lib/rbac/openfga-owned-resources-reconcile", () => ({
  deleteAllDataSourceRelationshipTuples: (...args: unknown[]) =>
    mockDeleteAllDataSourceRelationshipTuples(...args),
  deleteAllIngestionSourceRelationshipTuples: (...args: unknown[]) =>
    mockDeleteAllIngestionSourceRelationshipTuples(...args),
  deleteAllKnowledgeBaseRelationshipTuples: (...args: unknown[]) =>
    mockDeleteAllKnowledgeBaseRelationshipTuples(...args),
  reconcileDataSourceRelationships: (...args: unknown[]) =>
    mockReconcileDataSourceRelationships(...args),
  reconcileIngestionSourceRelationships: (...args: unknown[]) =>
    mockReconcileIngestionSourceRelationships(...args),
  reconcileKnowledgeBaseRelationships: (...args: unknown[]) =>
    mockReconcileKnowledgeBaseRelationships(...args),
}));

jest.mock("@/app/api/rag/sources/route", () => ({
  createIngestionSource: (...args: unknown[]) =>
    mockCreateIngestionSource(...args),
}));

const session = {
  sub: "admin-sub",
  accessToken: "token-123",
  org: "example-org",
};
const user = { email: "admin@example.com" };

function postRequest(body: unknown) {
  return new NextRequest(
    "http://localhost/api/admin/rag/sources/migrate-from-config",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

function redisDs(overrides: Record<string, unknown> = {}) {
  return {
    datasource_id: "slack-channel-C1",
    name: "eng-general",
    source_type: "slack",
    metadata: { channel_id: "C1" },
    ...overrides,
  };
}

function mockFetchDatasources(datasources: unknown[]) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue({
      success: true,
      datasources,
      count: datasources.length,
    }),
  });
}

function mockCollections(
  existingSources: Array<Record<string, unknown>> = [],
  teamSlugs = ["manage-team", "search-team", "shared-team"],
) {
  mockGetCollection.mockImplementation(async (name: string) => {
    if (name === "rag_ingestion_sources") {
      return {
        find: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnThis(),
          toArray: jest.fn().mockResolvedValue(existingSources),
        }),
      };
    }
    if (name === "teams") {
      return {
        find: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnThis(),
          toArray: jest
            .fn()
            .mockResolvedValue(teamSlugs.map((slug) => ({ slug }))),
        }),
      };
    }
    if (name === "dynamic_agents") {
      return {
        updateMany: (...args: unknown[]) => mockUpdateLegacyAgents(...args),
      };
    }
    throw new Error(`unexpected collection ${name}`);
  });
}

const migrationTeams = {
  management_team_slug: "manage-team",
  search_team_slug: "search-team",
};

describe("POST /api/admin/rag/sources/migrate-from-config", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user, session });
    mockRequireRbacPermission.mockResolvedValue(undefined);
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockDeleteAllDataSourceRelationshipTuples.mockResolvedValue({
      enabled: true,
    });
    mockDeleteAllIngestionSourceRelationshipTuples.mockResolvedValue({
      enabled: true,
    });
    mockDeleteAllKnowledgeBaseRelationshipTuples.mockResolvedValue({
      enabled: true,
    });
    mockReconcileDataSourceRelationships.mockResolvedValue({ enabled: true });
    mockReconcileIngestionSourceRelationships.mockResolvedValue({
      enabled: true,
    });
    mockReconcileKnowledgeBaseRelationships.mockResolvedValue({
      enabled: true,
    });
    mockAdoptConfigImportedRagSources.mockResolvedValue({
      adopted: [],
      skipped: [],
    });
    mockEnsurePlatformRagCollection.mockImplementation(
      async (input: { sourceIds?: string[] }) => ({
        _id: "platform-rag",
        source_ids: input.sourceIds ?? [],
      }),
    );
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true });
    mockUpdateLegacyAgents.mockResolvedValue({ modifiedCount: 2 });
    mockCollections();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("requires admin_ui admin permission", async () => {
    mockRequireRbacPermission.mockRejectedValue(new Error("forbidden"));

    const { POST } = await import("../route");
    await expect(POST(postRequest({ dry_run: true }))).rejects.toThrow(
      "forbidden",
    );
    expect(mockRequireRbacPermission).toHaveBeenCalledWith(
      session,
      "admin_ui",
      "admin",
    );
  });

  it("also requires organization management permission", async () => {
    mockRequireResourcePermission.mockRejectedValue(new Error("forbidden"));

    const { POST } = await import("../route");
    await expect(POST(postRequest({ dry_run: true }))).rejects.toThrow(
      "forbidden",
    );
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(session, {
      type: "organization",
      id: "example-org",
      action: "manage",
    });
  });

  it("dry_run: true returns a preview annotated with in_db/already_adopted, without adopting anything", async () => {
    mockFetchDatasources([
      redisDs({ datasource_id: "slack-channel-C1", name: "eng-general" }),
      redisDs({
        datasource_id: "slack-channel-C2",
        name: "eng-random",
        metadata: { channel_id: "C2" },
      }),
    ]);
    mockCollections([
      { source_id: "slack-channel-C1", config_import_adopted: false },
    ]);

    const { POST } = await import("../route");
    const response = await POST(postRequest({ dry_run: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.sources).toEqual([
      {
        source_id: "slack-channel-C1",
        name: "eng-general",
        source_type: "slack_channel",
        in_db: true,
        already_adopted: false,
        importable: false,
      },
      {
        source_id: "slack-channel-C2",
        name: "eng-random",
        source_type: "slack_channel",
        in_db: false,
        already_adopted: false,
        importable: true,
      },
    ]);
    expect(mockCreateIngestionSource).not.toHaveBeenCalled();
  });

  it("excludes datasources whose source_type has no self-service equivalent", async () => {
    mockFetchDatasources([
      redisDs({ datasource_id: "gh-1", source_type: "github", metadata: {} }),
    ]);
    mockCollections();

    const { POST } = await import("../route");
    const response = await POST(postRequest({ dry_run: true }));
    const body = await response.json();

    expect(body.data.sources).toEqual([]);
    expect(body.data.platform_collection.source_count).toBe(1);
  });

  it("does not treat scoped direct datasources without Mongo config rows as legacy-global", async () => {
    mockFetchDatasources([
      redisDs({
        datasource_id: "local-file-personal",
        name: "Personal files",
        source_type: "local_file",
        creator_subject: "user-sub",
        owner_subject: "user-sub",
        metadata: { files: [{ filename: "notes.pdf" }] },
      }),
      redisDs({
        datasource_id: "slack-channel-C2",
        name: "Team channel",
        metadata: { channel_id: "C2", config_managed: true },
        creator_subject: "user-sub",
        owner_team_slug: "manage-team",
        search_with_teams: ["search-team"],
      }),
    ]);
    mockCollections();

    const { POST } = await import("../route");
    const response = await POST(postRequest({ dry_run: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.sources).toEqual([]);
    expect(body.data.platform_collection.source_count).toBe(0);
  });

  it("does not replace policy or publish scoped direct datasources during apply", async () => {
    mockFetchDatasources([
      redisDs({
        datasource_id: "local-file-personal",
        source_type: "local_file",
        creator_subject: "user-sub",
        owner_subject: "user-sub",
        search_with_users: ["reader-sub"],
        metadata: { files: [{ filename: "notes.pdf" }] },
      }),
    ]);
    mockCollections();

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({ dry_run: false, source_ids: [], ...migrationTeams }),
    );

    expect(response.status).toBe(200);
    expect(mockDeleteAllDataSourceRelationshipTuples).not.toHaveBeenCalled();
    expect(mockDeleteAllKnowledgeBaseRelationshipTuples).not.toHaveBeenCalled();
    expect(
      mockDeleteAllIngestionSourceRelationshipTuples,
    ).not.toHaveBeenCalled();
    expect(mockReconcileDataSourceRelationships).not.toHaveBeenCalled();
    expect(mockReconcileKnowledgeBaseRelationships).not.toHaveBeenCalled();
    expect(mockReconcileIngestionSourceRelationships).not.toHaveBeenCalled();
    expect(mockCreateIngestionSource).not.toHaveBeenCalled();
    expect(mockEnsurePlatformRagCollection).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIds: [] }),
    );
  });

  it("keeps config-driven rows importable and in Platform RAG", async () => {
    mockFetchDatasources([redisDs()]);
    mockCollections([
      {
        source_id: "slack-channel-C1",
        config_driven: true,
        config_import_adopted: false,
      },
    ]);

    const { POST } = await import("../route");
    const response = await POST(postRequest({ dry_run: true }));
    const body = await response.json();

    expect(body.data.sources).toEqual([
      expect.objectContaining({
        source_id: "slack-channel-C1",
        in_db: true,
        already_adopted: false,
        importable: true,
      }),
    ]);
    expect(body.data.platform_collection.source_count).toBe(1);
  });

  it("adopts an existing config-driven row without inserting a duplicate", async () => {
    mockFetchDatasources([redisDs()]);
    mockCollections([
      {
        source_id: "slack-channel-C1",
        config_driven: true,
        config_import_adopted: false,
      },
    ]);
    mockAdoptConfigImportedRagSources.mockResolvedValue({
      adopted: ["slack-channel-C1"],
      skipped: [],
    });

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({
        dry_run: false,
        source_ids: ["slack-channel-C1"],
        ...migrationTeams,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCreateIngestionSource).not.toHaveBeenCalled();
    expect(mockAdoptConfigImportedRagSources).toHaveBeenCalledWith(
      ["slack-channel-C1"],
      { ownerTeamSlug: "manage-team" },
    );
    expect(body.data.adopted).toEqual(["slack-channel-C1"]);
  });

  it("gives unsupported legacy sources management policy without direct search grants", async () => {
    mockFetchDatasources([
      redisDs({
        datasource_id: "legacy-source",
        source_type: "example_connector",
        metadata: {},
      }),
    ]);
    mockCollections();

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({ dry_run: false, source_ids: [], ...migrationTeams }),
    );

    expect(response.status).toBe(200);
    expect(mockReconcileIngestionSourceRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "legacy-source",
        ownerTeamSlug: "manage-team",
      }),
    );
    expect(mockReconcileKnowledgeBaseRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: "legacy-source",
        ownerTeamSlug: null,
        nextSharedTeamSlugs: [],
      }),
    );
    expect(mockEnsurePlatformRagCollection).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIds: ["legacy-source"] }),
    );
  });

  it("does not replace source-level grants again after an unsupported source policy was adopted", async () => {
    mockFetchDatasources([
      redisDs({
        datasource_id: "legacy-source",
        source_type: "example_connector",
        metadata: {
          config_managed: true,
          config_import_adopted: true,
        },
      }),
    ]);
    mockCollections();

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({ dry_run: false, source_ids: [], ...migrationTeams }),
    );

    expect(response.status).toBe(200);
    expect(mockDeleteAllDataSourceRelationshipTuples).not.toHaveBeenCalled();
    expect(mockDeleteAllKnowledgeBaseRelationshipTuples).not.toHaveBeenCalled();
    expect(
      mockDeleteAllIngestionSourceRelationshipTuples,
    ).not.toHaveBeenCalled();
    expect(mockReconcileDataSourceRelationships).not.toHaveBeenCalled();
    expect(mockReconcileKnowledgeBaseRelationships).not.toHaveBeenCalled();
    expect(mockReconcileIngestionSourceRelationships).not.toHaveBeenCalled();
    expect(mockEnsurePlatformRagCollection).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIds: ["legacy-source"] }),
    );
  });

  it("apply (dry_run: false) creates config rows for the requested, not-yet-in-db source ids", async () => {
    mockFetchDatasources([
      redisDs({
        description: "Existing Slack source",
        metadata: {
          channel_id: "C1",
          lookback_days: 14,
          include_bots: true,
          last_ts: "123.456",
        },
      }),
    ]);
    mockCollections();
    mockCreateIngestionSource.mockResolvedValue({
      source_id: "slack-channel-C1",
    });

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({
        dry_run: false,
        source_ids: ["slack-channel-C1"],
        ...migrationTeams,
        management_shared_with_teams: ["shared-team"],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCreateIngestionSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "slack-channel-C1",
        fields: {
          source_type: "slack_channel",
          channel_id: "C1",
          lookback_days: 14,
          include_bots: true,
        },
        name: "eng-general",
        description: "Existing Slack source",
        ownerTeamSlug: "manage-team",
        sharedWithTeams: [],
        searchWithTeams: [],
        configImportAdopted: true,
      }),
    );
    expect(mockEnsurePlatformRagCollection).toHaveBeenCalledWith({
      actorSubject: "admin-sub",
      maintainerTeamSlugs: ["manage-team"],
      readerTeamSlugs: ["search-team"],
      sourceIds: ["slack-channel-C1"],
      mergeSourceIds: true,
    });
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [
        {
          user: "team:search-team#member",
          relation: "searcher",
          object: "organization:example-org",
        },
      ],
      deletes: [],
    });
    expect(mockUpdateLegacyAgents).toHaveBeenCalledWith(
      {
        "allowed_tools.knowledge-base": { $exists: true, $ne: false },
        $and: [
          {
            $or: [
              { rag_collection_ids: { $exists: false } },
              { rag_collection_ids: null },
            ],
          },
          {
            $or: [
              { datasource_ids: { $exists: false } },
              { datasource_ids: null },
            ],
          },
        ],
      },
      {
        $set: {
          rag_collection_ids: ["platform-rag"],
          updated_at: expect.any(String),
        },
      },
    );
    expect(mockReconcileKnowledgeBaseRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: "slack-channel-C1",
        ownerTeamSlug: null,
        nextSharedTeamSlugs: [],
      }),
    );
    expect(mockReconcileIngestionSourceRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "slack-channel-C1",
        ownerTeamSlug: "manage-team",
        nextSharedTeamSlugs: [],
      }),
    );
    expect(mockReconcileDataSourceRelationships).toHaveBeenCalledWith({
      dataSourceId: "slack-channel-C1",
      parentKnowledgeBaseId: "slack-channel-C1",
    });
    expect(mockDeleteAllIngestionSourceRelationshipTuples).toHaveBeenCalledWith(
      "slack-channel-C1",
    );
    expect(mockDeleteAllKnowledgeBaseRelationshipTuples).toHaveBeenCalledWith(
      "slack-channel-C1",
    );
    expect(mockDeleteAllDataSourceRelationshipTuples).toHaveBeenCalledWith(
      "slack-channel-C1",
    );
    const persistCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url, init]) =>
        url === "http://localhost:9446/v1/datasource" &&
        init?.method === "POST",
    );
    expect(JSON.parse(persistCall?.[1]?.body as string)).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          last_ts: "123.456",
          config_managed: true,
          config_import_adopted: true,
        }),
        owner_team_slug: "manage-team",
        owner_subject: null,
        shared_with_teams: [],
        search_with_teams: [],
      }),
    );
    expect(body.data.adopted).toEqual(["slack-channel-C1"]);
    expect(body.data.skipped).toEqual([]);
  });

  it("apply defaults source_ids to importable (not-yet-in-db) sources when omitted", async () => {
    mockFetchDatasources([
      redisDs({ datasource_id: "slack-channel-C1" }),
      redisDs({
        datasource_id: "slack-channel-C2",
        name: "eng-random",
        metadata: { channel_id: "C2" },
      }),
    ]);
    mockCollections([
      { source_id: "slack-channel-C2", config_import_adopted: true },
    ]);
    mockCreateIngestionSource.mockResolvedValue({
      source_id: "slack-channel-C1",
    });

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({ dry_run: false, ...migrationTeams }),
    );
    const body = await response.json();

    // slack-channel-C2 already has a config row, so only C1 is eligible by default.
    expect(mockCreateIngestionSource).toHaveBeenCalledTimes(1);
    expect(mockCreateIngestionSource).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "slack-channel-C1" }),
    );
    expect(body.data.adopted).toEqual(["slack-channel-C1"]);
  });

  it("preserves connector-specific Jira, web, and Confluence configuration", async () => {
    mockFetchDatasources([
      redisDs({
        datasource_id: "jira-example-primary",
        name: "Primary issues",
        source_type: "jira",
        metadata: {
          project_key: "EXAMPLE",
          jql: "project = EXAMPLE ORDER BY updated DESC",
          include_comments: false,
          include_links: false,
          custom_fields: { service: "customfield_123" },
        },
      }),
      redisDs({
        datasource_id: "src_web___example_com_docs",
        name: "Example docs",
        source_type: "web",
        metadata: {
          url_ingest_request: {
            url: "https://example.com/docs",
            settings: {
              crawl_mode: "recursive",
              max_depth: 4,
              max_pages: 250,
              render_javascript: true,
              allowed_url_patterns: ["^https://example\\.com/docs"],
            },
          },
        },
      }),
      redisDs({
        datasource_id: "src_confluence___example_atlassian_net__DOCS",
        name: "Documentation space",
        source_type: "confluence",
        metadata: {
          confluence_url: "https://example.atlassian.net/wiki",
          space_key: "DOCS",
          page_configs: [
            { page_id: "101", get_child_pages: true },
            {
              page_id: "202",
              source:
                "https://example.atlassian.net/wiki/spaces/DOCS/pages/202/Secondary",
              get_child_pages: false,
            },
          ],
          allowed_title_patterns: ["^Public"],
        },
      }),
    ]);
    mockCollections();
    mockCreateIngestionSource.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({
        dry_run: false,
        source_ids: [
          "jira-example-primary",
          "src_web___example_com_docs",
          "src_confluence___example_atlassian_net__DOCS",
        ],
        ...migrationTeams,
      }),
    );

    expect(response.status).toBe(200);
    expect(mockCreateIngestionSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "jira-example-primary",
        fields: expect.objectContaining({
          include_comments: false,
          include_links: false,
          custom_fields: { service: "customfield_123" },
        }),
      }),
    );
    expect(mockCreateIngestionSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "src_web___example_com_docs",
        fields: expect.objectContaining({
          settings: expect.objectContaining({
            crawl_mode: "recursive",
            max_depth: 4,
            render_javascript: true,
          }),
        }),
      }),
    );
    expect(mockCreateIngestionSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "src_confluence___example_atlassian_net__DOCS",
        fields: expect.objectContaining({
          start_page_url:
            "https://example.atlassian.net/wiki/spaces/DOCS/pages/101",
          get_child_pages: true,
          allowed_title_patterns: ["^Public"],
          page_configs: [
            { page_id: "101", source: null, get_child_pages: true },
            {
              page_id: "202",
              source:
                "https://example.atlassian.net/wiki/spaces/DOCS/pages/202/Secondary",
              get_child_pages: false,
            },
          ],
        }),
      }),
    );
  });

  it("adopts a whole-space Confluence config with no synthetic root page", async () => {
    mockFetchDatasources([
      redisDs({
        datasource_id: "src_confluence___example_atlassian_net__DOCS",
        name: "Documentation space",
        source_type: "confluence",
        metadata: {
          confluence_url: "https://example.atlassian.net/wiki",
          space_key: "DOCS",
          page_configs: [],
        },
      }),
    ]);
    mockCollections();
    mockCreateIngestionSource.mockResolvedValue({});

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({
        dry_run: false,
        source_ids: ["src_confluence___example_atlassian_net__DOCS"],
        ...migrationTeams,
      }),
    );

    expect(response.status).toBe(200);
    expect(mockCreateIngestionSource).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({
          whole_space: true,
          page_configs: [],
        }),
      }),
    );
    const fields = mockCreateIngestionSource.mock.calls[0][0].fields;
    expect(fields).not.toHaveProperty("start_page_url");
  });

  it("skips a requested id that already has a config row instead of re-creating it", async () => {
    mockFetchDatasources([redisDs({ datasource_id: "slack-channel-C1" })]);
    mockCollections([
      { source_id: "slack-channel-C1", config_import_adopted: true },
    ]);

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({
        dry_run: false,
        source_ids: ["slack-channel-C1"],
        ...migrationTeams,
      }),
    );
    const body = await response.json();

    expect(mockCreateIngestionSource).not.toHaveBeenCalled();
    expect(body.data.adopted).toEqual([]);
    expect(body.data.skipped).toEqual([
      { source_id: "slack-channel-C1", reason: "already_in_db" },
    ]);
  });

  it("skips a requested id with no matching Redis datasource", async () => {
    mockFetchDatasources([]);
    mockCollections();

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({
        dry_run: false,
        source_ids: ["ghost-source"],
        ...migrationTeams,
      }),
    );
    const body = await response.json();

    expect(mockCreateIngestionSource).not.toHaveBeenCalled();
    expect(body.data.skipped).toEqual([
      { source_id: "ghost-source", reason: "not_found_in_redis" },
    ]);
  });

  it("returns 404 when the requested management team does not exist", async () => {
    mockFetchDatasources([]);
    mockCollections([], ["search-team"]);

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({
        dry_run: false,
        source_ids: [],
        management_team_slug: "missing-team",
        search_team_slug: "search-team",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("MANAGEMENT_TEAM_NOT_FOUND");
    expect(mockCreateIngestionSource).not.toHaveBeenCalled();
  });
});
