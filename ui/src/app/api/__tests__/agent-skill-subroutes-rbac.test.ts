/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetCollection = jest.fn();
const mockGetUserTeamIds = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockListRevisions = jest.fn();

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
  const user = { email: "alice@example.com", role: "user" };
  const session = { sub: "alice-sub", role: "user" };
  return {
    ApiError,
    getUserTeamIds: (...args: unknown[]) => mockGetUserTeamIds(...args),
    successResponse: (data: unknown, status = 200) => Response.json({ success: true, data }, { status }),
    withAuth: async (_request: NextRequest, handler: (...args: unknown[]) => Promise<Response>) =>
      handler(_request, user, session),
    withErrorHandler:
      <T,>(handler: (...args: unknown[]) => Promise<T>) =>
      async (...args: unknown[]) => {
        try {
          return await handler(...args);
        } catch (error) {
          return Response.json(
            { success: false, error: error instanceof Error ? error.message : "error" },
            { status: (error as { statusCode?: number }).statusCode ?? 500 },
          );
        }
      },
  };
});

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

jest.mock("@/lib/skill-revisions", () => ({
  listRevisions: (...args: unknown[]) => mockListRevisions(...args),
}));

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("skill subroute RBAC cutover", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserTeamIds.mockResolvedValue(["legacy-team"]);
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockListRevisions.mockResolvedValue([{ id: "rev-1", revision_number: 1 }]);
  });

  it("loads skills by id without legacy visibility/team prefiltering", async () => {
    const skill = { id: "skill-openfga-only", name: "OpenFGA Only", owner_id: "bob@example.com" };
    const findOne = jest.fn(async (query: Record<string, unknown>) =>
      Object.keys(query).length === 1 && query.id === skill.id ? skill : null,
    );
    mockGetCollection.mockResolvedValue({ findOne });
    const { getAgentSkillVisibleToUser } = await import("@/lib/agent-skill-visibility");

    const result = await getAgentSkillVisibleToUser("skill-openfga-only", "alice@example.com");

    expect(result).toEqual(skill);
    expect(mockGetUserTeamIds).not.toHaveBeenCalled();
    expect(findOne).toHaveBeenCalledWith({ id: "skill-openfga-only" });
  });

  it("requires OpenFGA read permission before returning revision history", async () => {
    const skill = { id: "skill-openfga-only", name: "OpenFGA Only", owner_id: "bob@example.com" };
    const findOne = jest.fn(async (query: Record<string, unknown>) =>
      Object.keys(query).length === 1 && query.id === skill.id ? skill : null,
    );
    mockGetCollection.mockResolvedValue({ findOne });
    const { GET } = await import("../skills/configs/[id]/revisions/route");

    const response = await GET(request("/api/skills/configs/skill-openfga-only/revisions"), {
      params: Promise.resolve({ id: "skill-openfga-only" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "alice-sub" }),
      { type: "skill", id: "skill-openfga-only", action: "read" },
    );
    expect(body.data.revisions).toEqual([{ id: "rev-1", revision_number: 1 }]);
  });
});
