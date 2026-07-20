/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockGetCollection = jest.fn();
const mockRequireConversationResourcePermission = jest.fn();

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
    getAuthFromBearerOrSession: (...args: unknown[]) =>
      mockGetAuthFromBearerOrSession(...args),
    successResponse: (data: unknown, status = 200) =>
      Response.json({ success: true, data }, { status }),
    withErrorHandler:
      <T,>(handler: (request: NextRequest) => Promise<T>) =>
      async (request: NextRequest) => {
        try {
          return await handler(request);
        } catch (error) {
          return Response.json(
            {
              success: false,
              error: error instanceof Error ? error.message : "error",
            },
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
  requireConversationResourcePermission: (...args: unknown[]) =>
    mockRequireConversationResourcePermission(...args),
}));

function request(query = "idempotency_key=111.222"): NextRequest {
  return new NextRequest(
    new URL(`/api/chat/conversations/lookup?${query}`, "http://localhost:3000"),
  );
}

const conversation = {
  _id: "11111111-1111-4111-8111-111111111111",
  title: "Example conversation",
  client_type: "slack",
  owner_id: "test-user@example.com",
  idempotency_key: "111.222",
  metadata: {
    channel_id: "C123",
    originator_slack_user_id: "U_ORIG",
    thread_owner_agent_id: "primary",
  },
};

describe("GET /api/chat/conversations/lookup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "service-account@example.com" },
      session: { sub: "service-account-sub", isServiceAccount: true },
    });
    mockRequireConversationResourcePermission.mockResolvedValue(undefined);
  });

  it("returns an authorized existing Slack conversation without creating one", async () => {
    const findOne = jest.fn().mockResolvedValue(conversation);
    mockGetCollection.mockResolvedValue({ findOne });
    const { GET } = await import("../chat/conversations/lookup/route");

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(findOne).toHaveBeenCalledWith({
      idempotency_key: "111.222",
      client_type: "slack",
      $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }],
    });
    expect(mockRequireConversationResourcePermission).toHaveBeenCalledWith(
      expect.objectContaining({ isServiceAccount: true }),
      "service-account@example.com",
      conversation,
      "read",
    );
    expect(body.data.conversation).toEqual({
      _id: conversation._id,
      client_type: "slack",
      metadata: conversation.metadata,
    });
  });

  it("returns 404 without mutating when the key is unknown", async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    mockGetCollection.mockResolvedValue({ findOne });
    const { GET } = await import("../chat/conversations/lookup/route");

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockRequireConversationResourcePermission).not.toHaveBeenCalled();
  });

  it("enforces per-conversation read permission", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(conversation),
    });
    mockRequireConversationResourcePermission.mockRejectedValue(
      Object.assign(new Error("Permission denied"), { statusCode: 403 }),
    );
    const { GET } = await import("../chat/conversations/lookup/route");

    const response = await GET(request());

    expect(response.status).toBe(403);
  });

  it("rejects a missing idempotency key before querying MongoDB", async () => {
    const { GET } = await import("../chat/conversations/lookup/route");

    const response = await GET(request(""));

    expect(response.status).toBe(400);
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("rejects an unknown client type", async () => {
    const { GET } = await import("../chat/conversations/lookup/route");

    const response = await GET(
      request("idempotency_key=111.222&client_type=unknown"),
    );

    expect(response.status).toBe(400);
    expect(mockGetCollection).not.toHaveBeenCalled();
  });
});
