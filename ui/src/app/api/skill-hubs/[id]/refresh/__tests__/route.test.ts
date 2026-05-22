/**
 * @jest-environment node
 */

const mockGetCollection = jest.fn();
const mockGetHubSkills = jest.fn();
const mockGrantSkillsToTeams = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public statusCode = 500,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: jest.fn(async () => ({
      user: { email: "admin@example.com", role: "admin" },
      session: { sub: "admin-sub", role: "admin" },
    })),
    requireRbacPermission: jest.fn(async () => undefined),
    withErrorHandler:
      <T,>(handler: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<T>) =>
      async (request: Request, context: { params: Promise<{ id: string }> }) => {
        try {
          return await handler(request, context);
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "error" },
            { status: (error as { statusCode?: number }).statusCode ?? 500 },
          );
        }
      },
  };
});

jest.mock("@/lib/hub-crawl", () => ({
  getHubSkills: (...args: unknown[]) => mockGetHubSkills(...args),
  resolveHubToken: jest.fn(),
}));

jest.mock("@/lib/rbac/skill-team-grants", () => ({
  grantSkillsToTeams: (...args: unknown[]) => mockGrantSkillsToTeams(...args),
}));

function makeRequest(): Request {
  return new Request("http://localhost/api/skill-hubs/hub-1/refresh", {
    method: "POST",
  });
}

describe("POST /api/skill-hubs/[id]/refresh team grants", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGrantSkillsToTeams.mockResolvedValue({ enabled: true, writesApplied: 2 });
  });

  it("grants configured teams access to all refreshed hub skill ids", async () => {
    const hub = {
      id: "hub-1",
      type: "github",
      location: "owner/repo",
      shared_with_teams: ["platform"],
    };
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(hub),
    });
    mockGetHubSkills.mockResolvedValue([
      { id: "hub-hub-1-skill-a", name: "A" },
      { id: "hub-hub-1-skill-b", name: "B" },
    ]);
    const { POST } = await import("../route");

    const response = await POST(makeRequest() as never, {
      params: Promise.resolve({ id: "hub-1" }),
    });

    expect(response.status).toBe(200);
    expect(mockGrantSkillsToTeams).toHaveBeenCalledWith({
      teamRefs: ["platform"],
      skillIds: ["hub-hub-1-skill-a", "hub-hub-1-skill-b"],
    });
  });
});
