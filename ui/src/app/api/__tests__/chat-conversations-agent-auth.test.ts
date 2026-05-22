/**
 * @jest-environment node
 */

import { NextRequest, NextResponse } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockGetCollection = jest.fn();
const mockRequireAgentUsePermission = jest.fn();
const mockGetUserTeamIds = jest.fn();
const mockFilterConversationsByImplicitOrExplicitPermission = jest.fn();

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
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
    getPaginationParams: () => ({ page: 1, pageSize: 20, skip: 0 }),
    getUserTeamIds: (...args: unknown[]) => mockGetUserTeamIds(...args),
    paginatedResponse: (items: unknown[], total: number, page: number, pageSize: number) =>
      Response.json({ success: true, data: { items, pagination: { total, page, pageSize } } }),
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    successResponse: (data: unknown, status = 200) => Response.json({ success: true, data }, { status }),
    validateRequired: (body: Record<string, unknown>, fields: string[]) => {
      for (const field of fields) {
        if (!body[field]) throw new ApiError(`Missing required field: ${field}`, 400);
      }
    },
    withErrorHandler:
      <T,>(handler: (request: NextRequest) => Promise<T>) =>
      async (request: NextRequest) => {
        try {
          return await handler(request);
        } catch (error) {
          return Response.json(
            { success: false, error: error instanceof Error ? error.message : "error" },
            { status: (error as { statusCode?: number }).statusCode ?? 500 },
          );
        }
      },
  };
});

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/rbac/conversation-implicit-authz", () => ({
  filterConversationsByImplicitOrExplicitPermission: (...args: unknown[]) =>
    mockFilterConversationsByImplicitOrExplicitPermission(...args),
}));

jest.mock("@/lib/rbac/openfga-agent-authz", () => ({
  requireAgentUsePermission: (...args: unknown[]) => mockRequireAgentUsePermission(...args),
}));

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL("/api/chat/conversations", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat/conversations agent authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "alice@example.com", name: "Alice" },
      session: { sub: "alice-sub", role: "user" },
    });
    mockRequireRbacPermission.mockResolvedValue(undefined);
    mockRequireAgentUsePermission.mockResolvedValue(null);
    mockGetUserTeamIds.mockResolvedValue(["legacy-team"]);
    mockFilterConversationsByImplicitOrExplicitPermission.mockImplementation(
      async (_session, _email, items) => items,
    );
  });

  it("lists candidate conversations without legacy team prefiltering before OpenFGA filtering", async () => {
    const candidate = {
      _id: "conv-openfga-only",
      title: "OpenFGA Only",
      client_type: "webui",
      owner_id: "bob@example.com",
      sharing: { is_public: false, shared_with: [], shared_with_teams: [] },
      metadata: {},
    };
    const limit = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([candidate]) });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    const find = jest.fn().mockReturnValue({ sort });
    const countDocuments = jest.fn().mockResolvedValue(1);
    mockGetCollection.mockResolvedValue({ find, countDocuments });
    const { GET } = await import("../chat/conversations/route");

    const response = await GET(new NextRequest(new URL("/api/chat/conversations", "http://localhost:3000")));

    expect(response.status).toBe(200);
    expect(mockGetUserTeamIds).not.toHaveBeenCalled();
    expect(countDocuments).toHaveBeenCalledWith(
      expect.not.objectContaining({
        $or: expect.any(Array),
      }),
    );
    expect(mockFilterConversationsByImplicitOrExplicitPermission).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "alice-sub" }),
      "alice@example.com",
      [candidate],
    );
  });

  it("checks OpenFGA can_use before binding a dynamic agent to a new conversation", async () => {
    const insertOne = jest.fn().mockResolvedValue({ insertedId: "conv-1" });
    mockGetCollection.mockResolvedValue({ findOne: jest.fn(), insertOne });
    const { POST } = await import("../chat/conversations/route");

    const response = await POST(
      request({
        title: "New Conversation",
        client_type: "webui",
        agent_id: "foo-bar",
      }),
    );

    expect(response.status).toBe(201);
    expect(mockRequireAgentUsePermission).toHaveBeenCalledWith({
      subject: "alice-sub",
      agentId: "foo-bar",
      email: "alice@example.com",
    });
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        participants: expect.arrayContaining([expect.objectContaining({ type: "agent", id: "foo-bar" })]),
      }),
    );
  });

  it("does not create the conversation when OpenFGA denies agent use", async () => {
    const insertOne = jest.fn();
    mockGetCollection.mockResolvedValue({ findOne: jest.fn(), insertOne });
    mockRequireAgentUsePermission.mockResolvedValue(
      NextResponse.json(
        { success: false, error: "Permission denied", code: "agent#use" },
        { status: 403 },
      ),
    );
    const { POST } = await import("../chat/conversations/route");

    const response = await POST(
      request({
        title: "New Conversation",
        client_type: "webui",
        agent_id: "foo-bar",
      }),
    );

    expect(response.status).toBe(403);
    expect(insertOne).not.toHaveBeenCalled();
  });
});
