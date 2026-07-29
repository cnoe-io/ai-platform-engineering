/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockGetCollection = jest.fn();
const mockLoadSeedConfig = jest.fn();
const mockExtractRagSourceTypeFields = jest.fn();
const mockAdoptConfigImportedRagSources = jest.fn();

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

jest.mock("@/lib/seed-config", () => ({
  loadSeedConfig: (...args: unknown[]) => mockLoadSeedConfig(...args),
  extractRagSourceTypeFields: (...args: unknown[]) => mockExtractRagSourceTypeFields(...args),
  adoptConfigImportedRagSources: (...args: unknown[]) => mockAdoptConfigImportedRagSources(...args),
}));

const session = { sub: "admin-sub" };
const user = { email: "admin@example.com" };

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/rag/sources/migrate-from-config", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function extractedFor(sourceType: string, channelId: string) {
  return { identity: { source_type: sourceType, channel_id: channelId }, fields: {} };
}

describe("POST /api/admin/rag/sources/migrate-from-config", () => {
  const ORIGINAL_CONFIG_PATH = process.env.APP_CONFIG_PATH;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user, session });
    mockRequireRbacPermission.mockResolvedValue(undefined);
    process.env.APP_CONFIG_PATH = "/config/config.yaml";
  });

  afterAll(() => {
    if (ORIGINAL_CONFIG_PATH === undefined) {
      delete process.env.APP_CONFIG_PATH;
    } else {
      process.env.APP_CONFIG_PATH = ORIGINAL_CONFIG_PATH;
    }
  });

  it("requires admin_ui admin permission", async () => {
    mockRequireRbacPermission.mockRejectedValue(new Error("forbidden"));

    const { POST } = await import("../route");
    await expect(POST(postRequest({ dry_run: true }))).rejects.toThrow("forbidden");
    expect(mockRequireRbacPermission).toHaveBeenCalledWith(session, "admin_ui", "admin");
  });

  it("dry_run: true returns a preview annotated with in_db/already_adopted, without adopting anything", async () => {
    mockLoadSeedConfig.mockReturnValue({
      rag_sources: [
        { source_type: "slack_channel", channel_id: "C1", name: "eng-general" },
        { source_type: "slack_channel", channel_id: "C2", name: "eng-random" },
      ],
    });
    mockExtractRagSourceTypeFields
      .mockReturnValueOnce(extractedFor("slack_channel", "C1"))
      .mockReturnValueOnce(extractedFor("slack_channel", "C2"));
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([
          { source_id: "slack-channel-C1", config_driven: true, config_import_adopted: false },
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
    expect(mockAdoptConfigImportedRagSources).not.toHaveBeenCalled();
  });

  it("apply (dry_run: false) adopts the requested source ids with the team assignment", async () => {
    mockLoadSeedConfig.mockReturnValue({
      rag_sources: [{ source_type: "slack_channel", channel_id: "C1", name: "eng-general" }],
    });
    mockExtractRagSourceTypeFields.mockReturnValue(extractedFor("slack_channel", "C1"));
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "rag_ingestion_sources") {
        return {
          find: jest.fn().mockReturnValue({
            project: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue([
              { source_id: "slack-channel-C1", config_driven: true, config_import_adopted: false },
            ]),
          }),
        };
      }
      if (name === "teams") {
        return { findOne: jest.fn().mockResolvedValue({ slug: "platform" }) };
      }
      throw new Error(`unexpected collection ${name}`);
    });
    mockAdoptConfigImportedRagSources.mockResolvedValue({ adopted: ["slack-channel-C1"], skipped: [] });

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
    expect(mockAdoptConfigImportedRagSources).toHaveBeenCalledWith(["slack-channel-C1"], {
      ownerTeamSlug: "platform",
      sharedTeamSlugs: ["sre"],
    });
    expect(body.data.adopted).toEqual(["slack-channel-C1"]);
    expect(body.data.skipped).toEqual([]);
  });

  it("apply defaults source_ids to importable (in_db, not-yet-adopted) sources when omitted", async () => {
    mockLoadSeedConfig.mockReturnValue({
      rag_sources: [
        { source_type: "slack_channel", channel_id: "C1", name: "eng-general" },
        { source_type: "slack_channel", channel_id: "C2", name: "eng-random" },
      ],
    });
    mockExtractRagSourceTypeFields
      .mockReturnValueOnce(extractedFor("slack_channel", "C1"))
      .mockReturnValueOnce(extractedFor("slack_channel", "C2"));
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([
          { source_id: "slack-channel-C1", config_driven: true, config_import_adopted: false },
          { source_id: "slack-channel-C2", config_driven: true, config_import_adopted: true },
        ]),
      }),
    });
    mockAdoptConfigImportedRagSources.mockResolvedValue({ adopted: ["slack-channel-C1"], skipped: [] });

    const { POST } = await import("../route");
    await POST(postRequest({ dry_run: false }));

    // slack-channel-C2 is already adopted, so only C1 is eligible by default.
    expect(mockAdoptConfigImportedRagSources).toHaveBeenCalledWith(["slack-channel-C1"], {
      ownerTeamSlug: null,
      sharedTeamSlugs: [],
    });
  });

  it("returns 404 when the requested owner team does not exist", async () => {
    mockLoadSeedConfig.mockReturnValue({ rag_sources: [] });
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
    expect(mockAdoptConfigImportedRagSources).not.toHaveBeenCalled();
  });
});
