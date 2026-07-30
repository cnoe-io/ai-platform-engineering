/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockGetCollection = jest.fn();
const mockCreateIngestionSource = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    successResponse: (data: unknown) => Response.json({ success: true, data }),
    withErrorHandler:
      <T,>(handler: (request: NextRequest) => Promise<T>) =>
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

jest.mock("@/app/api/rag/sources/route", () => ({
  createIngestionSource: (...args: unknown[]) => mockCreateIngestionSource(...args),
}));

const session = { sub: "admin-sub", accessToken: "token-123", org: "example-org" };
const user = { email: "admin@example.com" };

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/rag/sources/migrate-from-config", {
    method: "POST",
    body: JSON.stringify(body),
  });
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
    json: jest.fn().mockResolvedValue({ success: true, datasources, count: datasources.length }),
  });
}

describe("POST /api/admin/rag/sources/migrate-from-config", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user, session });
    mockRequireRbacPermission.mockResolvedValue(undefined);
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("requires admin_ui admin permission", async () => {
    mockRequireRbacPermission.mockRejectedValue(new Error("forbidden"));

    const { POST } = await import("../route");
    await expect(POST(postRequest({ dry_run: true }))).rejects.toThrow("forbidden");
    expect(mockRequireRbacPermission).toHaveBeenCalledWith(session, "admin_ui", "admin");
  });

  it("dry_run: true returns a preview annotated with in_db/already_adopted, without adopting anything", async () => {
    mockFetchDatasources([
      redisDs({ datasource_id: "slack-channel-C1", name: "eng-general" }),
      redisDs({ datasource_id: "slack-channel-C2", name: "eng-random", metadata: { channel_id: "C2" } }),
    ]);
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([
          { source_id: "slack-channel-C1", config_import_adopted: false },
        ]),
      }),
    });

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
      },
      {
        source_id: "slack-channel-C2",
        name: "eng-random",
        source_type: "slack_channel",
        in_db: false,
        already_adopted: false,
      },
    ]);
    expect(mockCreateIngestionSource).not.toHaveBeenCalled();
  });

  it("excludes datasources whose source_type has no self-service equivalent", async () => {
    mockFetchDatasources([redisDs({ datasource_id: "gh-1", source_type: "github", metadata: {} })]);
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });

    const { POST } = await import("../route");
    const response = await POST(postRequest({ dry_run: true }));
    const body = await response.json();

    expect(body.data.sources).toEqual([]);
  });

  it("apply (dry_run: false) creates config rows for the requested, not-yet-in-db source ids", async () => {
    mockFetchDatasources([redisDs()]);
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "rag_ingestion_sources") {
        return {
          find: jest.fn().mockReturnValue({
            project: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue([]),
          }),
        };
      }
      if (name === "teams") {
        return { findOne: jest.fn().mockResolvedValue({ slug: "platform" }) };
      }
      throw new Error(`unexpected collection ${name}`);
    });
    mockCreateIngestionSource.mockResolvedValue({ source_id: "slack-channel-C1" });

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({
        dry_run: false,
        source_ids: ["slack-channel-C1"],
        owner_team_slug: "platform",
        shared_with_teams: ["sre"],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCreateIngestionSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "slack-channel-C1",
        fields: { source_type: "slack_channel", channel_id: "C1", lookback_days: undefined },
        name: "eng-general",
        ownerTeamSlug: "platform",
        sharedWithTeams: ["sre"],
        configImportAdopted: true,
      }),
    );
    expect(body.data.adopted).toEqual(["slack-channel-C1"]);
    expect(body.data.skipped).toEqual([]);
  });

  it("apply defaults source_ids to importable (not-yet-in-db) sources when omitted", async () => {
    mockFetchDatasources([
      redisDs({ datasource_id: "slack-channel-C1" }),
      redisDs({ datasource_id: "slack-channel-C2", name: "eng-random", metadata: { channel_id: "C2" } }),
    ]);
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([
          { source_id: "slack-channel-C2", config_import_adopted: true },
        ]),
      }),
    });
    mockCreateIngestionSource.mockResolvedValue({ source_id: "slack-channel-C1" });

    const { POST } = await import("../route");
    const response = await POST(postRequest({ dry_run: false }));
    const body = await response.json();

    // slack-channel-C2 already has a config row, so only C1 is eligible by default.
    expect(mockCreateIngestionSource).toHaveBeenCalledTimes(1);
    expect(mockCreateIngestionSource).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "slack-channel-C1" }),
    );
    expect(body.data.adopted).toEqual(["slack-channel-C1"]);
  });

  it("skips a requested id that already has a config row instead of re-creating it", async () => {
    mockFetchDatasources([redisDs({ datasource_id: "slack-channel-C1" })]);
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([
          { source_id: "slack-channel-C1", config_import_adopted: true },
        ]),
      }),
    });

    const { POST } = await import("../route");
    const response = await POST(postRequest({ dry_run: false, source_ids: ["slack-channel-C1"] }));
    const body = await response.json();

    expect(mockCreateIngestionSource).not.toHaveBeenCalled();
    expect(body.data.adopted).toEqual([]);
    expect(body.data.skipped).toEqual([{ source_id: "slack-channel-C1", reason: "already_in_db" }]);
  });

  it("skips a requested id with no matching Redis datasource", async () => {
    mockFetchDatasources([]);
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });

    const { POST } = await import("../route");
    const response = await POST(postRequest({ dry_run: false, source_ids: ["ghost-source"] }));
    const body = await response.json();

    expect(mockCreateIngestionSource).not.toHaveBeenCalled();
    expect(body.data.skipped).toEqual([{ source_id: "ghost-source", reason: "not_found_in_redis" }]);
  });

  it("returns 404 when the requested owner team does not exist", async () => {
    mockFetchDatasources([]);
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "rag_ingestion_sources") {
        return {
          find: jest.fn().mockReturnValue({
            project: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue([]),
          }),
        };
      }
      if (name === "teams") {
        return { findOne: jest.fn().mockResolvedValue(null) };
      }
      throw new Error(`unexpected collection ${name}`);
    });

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({ dry_run: false, source_ids: [], owner_team_slug: "ghost-team" }),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("OWNER_TEAM_NOT_FOUND");
    expect(mockCreateIngestionSource).not.toHaveBeenCalled();
  });
});
