/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockGetCollection = jest.fn();
const mockLoadSeedConfig = jest.fn();
const mockAdoptConfigImportedAgents = jest.fn();

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
  adoptConfigImportedAgents: (...args: unknown[]) => mockAdoptConfigImportedAgents(...args),
}));

const session = { sub: "admin-sub" };
const user = { email: "admin@example.com" };

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/dynamic-agents/runtime/sync-from-config", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/dynamic-agents/runtime/sync-from-config", () => {
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

  it("dry_run: true returns a preview without adopting anything", async () => {
    mockLoadSeedConfig.mockReturnValue({
      agents: [
        { id: "agent-1", name: "Agent One", description: "desc" },
        { id: "agent-2", name: "Agent Two" },
      ],
    });
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([
          { _id: "agent-1", config_driven: true, config_import_adopted: false },
        ]),
      }),
    });

    const { POST } = await import("../route");
    const response = await POST(postRequest({ dry_run: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.agents).toEqual([
      { id: "agent-1", name: "Agent One", description: "desc", in_db: true, already_adopted: false },
      { id: "agent-2", name: "Agent Two", description: undefined, in_db: false, already_adopted: false },
    ]);
    expect(mockAdoptConfigImportedAgents).not.toHaveBeenCalled();
  });

  it("apply (dry_run: false) adopts the requested agent ids with the team assignment", async () => {
    mockLoadSeedConfig.mockReturnValue({
      agents: [{ id: "agent-1", name: "Agent One" }],
    });
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "dynamic_agents") {
        return {
          find: jest.fn().mockReturnValue({
            project: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue([
              { _id: "agent-1", config_driven: true, config_import_adopted: false },
            ]),
          }),
        };
      }
      if (name === "teams") {
        return { findOne: jest.fn().mockResolvedValue({ slug: "platform" }) };
      }
      throw new Error(`unexpected collection ${name}`);
    });
    mockAdoptConfigImportedAgents.mockResolvedValue({ adopted: ["agent-1"], skipped: [] });

    const { POST } = await import("../route");
    const response = await POST(
      postRequest({
        dry_run: false,
        agent_ids: ["agent-1"],
        owner_team_slug: "platform",
        shared_with_teams: ["sre"],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockAdoptConfigImportedAgents).toHaveBeenCalledWith(["agent-1"], {
      ownerTeamSlug: "platform",
      sharedTeamSlugs: ["sre"],
    });
    expect(body.data.adopted).toEqual(["agent-1"]);
    expect(body.data.skipped).toEqual([]);
  });

  it("apply defaults agent_ids to importable (in_db, not-yet-adopted) agents when omitted", async () => {
    mockLoadSeedConfig.mockReturnValue({
      agents: [
        { id: "agent-1", name: "Agent One" },
        { id: "agent-2", name: "Agent Two" },
      ],
    });
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([
          { _id: "agent-1", config_driven: true, config_import_adopted: false },
          { _id: "agent-2", config_driven: true, config_import_adopted: true },
        ]),
      }),
    });
    mockAdoptConfigImportedAgents.mockResolvedValue({ adopted: ["agent-1"], skipped: [] });

    const { POST } = await import("../route");
    await POST(postRequest({ dry_run: false }));

    // agent-2 is already adopted, so only agent-1 is eligible by default.
    expect(mockAdoptConfigImportedAgents).toHaveBeenCalledWith(["agent-1"], {
      ownerTeamSlug: null,
      sharedTeamSlugs: [],
    });
  });

  it("returns 404 when the requested owner team does not exist", async () => {
    mockLoadSeedConfig.mockReturnValue({ agents: [] });
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "dynamic_agents") {
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
      postRequest({ dry_run: false, agent_ids: [], owner_team_slug: "ghost-team" }),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("OWNER_TEAM_NOT_FOUND");
    expect(mockAdoptConfigImportedAgents).not.toHaveBeenCalled();
  });
});
