/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuth = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockResolveSimulationScope = jest.fn();
const mockSimulationCanManage = jest.fn();
const mockFindUser = jest.fn();
const mockFindConversations = jest.fn();
const mockCountConversations = jest.fn();
const mockAggregateFeedback = jest.fn();
const mockFindFeedback = jest.fn();
const mockGetRealmUserById = jest.fn();

let mongoConfigured = true;

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuth(...args),
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
  };
});

jest.mock("@/lib/rbac/admin-simulation-server", () => ({
  resolveAuthorizedAdminSimulationScope: (...args: unknown[]) =>
    mockResolveSimulationScope(...args),
  simulationSubjectCanManageAdminSurface: (...args: unknown[]) =>
    mockSimulationCanManage(...args),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  getRealmUserById: (...args: unknown[]) => mockGetRealmUserById(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  get isMongoDBConfigured() {
    return mongoConfigured;
  },
  getCollection: async (name: string) => {
    if (name === "users") {
      return { findOne: (...args: unknown[]) => mockFindUser(...args) };
    }
    if (name === "conversations") {
      return {
        find: (...args: unknown[]) => {
          mockFindConversations(...args);
          return {
            sort: () => ({
              limit: () => ({ toArray: () => mockFindConversations() }),
            }),
          };
        },
        countDocuments: (...args: unknown[]) => mockCountConversations(...args),
      };
    }
    if (name === "feedback") {
      return {
        aggregate: (...args: unknown[]) => {
          mockAggregateFeedback(...args);
          return { toArray: () => mockAggregateFeedback() };
        },
        find: (...args: unknown[]) => {
          mockFindFeedback(...args);
          return {
            sort: () => ({
              limit: () => ({ toArray: () => mockFindFeedback() }),
            }),
          };
        },
      };
    }
    throw new Error(`Unexpected collection: ${name}`);
  },
}));

function request(identity: string, query = "") {
  return {
    request: new NextRequest(
      new URL(
        `/api/admin/users/activity/${encodeURIComponent(identity)}${query}`,
        "http://localhost:3000",
      ),
    ),
    context: { params: Promise.resolve({ identity }) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mongoConfigured = true;
  mockGetAuth.mockResolvedValue({ session: { sub: "admin-sub" } });
  mockRequireRbacPermission.mockResolvedValue(undefined);
  mockResolveSimulationScope.mockResolvedValue(null);
  mockSimulationCanManage.mockResolvedValue(true);
  mockFindUser.mockResolvedValue({
    email: "test-user@example.com",
    name: "Test User",
    slack_user_id: "U123TEST",
    source: "web",
    avatar_url: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    last_login: new Date("2026-07-20T00:00:00.000Z"),
    metadata: { role: "user" },
  });
  mockFindConversations
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce([
      {
        _id: "conversation-1",
        title: "Example conversation",
        client_type: "slack",
        metadata: { channel_id: "C123TEST", channel_name: "example-channel" },
        created_at: new Date("2026-07-20T10:00:00.000Z"),
        updated_at: new Date("2026-07-20T11:00:00.000Z"),
      },
    ]);
  mockCountConversations.mockResolvedValue(3);
  mockAggregateFeedback
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce([{ total: 2, positive: 1, negative: 1 }]);
  mockFindFeedback
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce([
      {
        source: "web",
        rating: "positive",
        value: "thumbs_up",
        conversation_id: "conversation-1",
        created_at: new Date("2026-07-20T11:05:00.000Z"),
      },
    ]);
});

describe("GET /api/admin/users/activity/[identity]", () => {
  it("loads activity by analytics identity without treating the email as a Keycloak id", async () => {
    const { GET } = await import("../route");
    const { request: req,context } = request("test-user@example.com");

    const response = await GET(req, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireRbacPermission).toHaveBeenCalledWith(
      { sub: "admin-sub" },
      "admin_ui",
      "view",
    );
    expect(mockGetRealmUserById).not.toHaveBeenCalled();
    expect(mockCountConversations).toHaveBeenCalledWith({
      owner_id: {
        $in: expect.arrayContaining(["test-user@example.com", "U123TEST"]),
      },
    });
    expect(body.data).toMatchObject({
      profile: {
        email: "test-user@example.com",
        name: "Test User",
        slack_user_id: "U123TEST",
      },
      stats: {
        total_conversations: 3,
        feedback_given: 2,
        feedback_positive: 1,
        feedback_negative: 1,
      },
      recent_conversations: [
        {
          id: "conversation-1",
          source: "slack",
          channel_id: "C123TEST",
          channel_name: "example-channel",
        },
      ],
    });
  });

  it("does not let a scoped preview subject widen itself to another user's activity", async () => {
    mockResolveSimulationScope.mockResolvedValue({
      openfgaUser: "user:preview-sub",
      ownerEmail: "preview@example.com",
      subjectType: "user",
      subjectId: "preview-sub",
    });
    mockSimulationCanManage.mockResolvedValue(false);
    const { GET } = await import("../route");
    const { request: req,context } = request(
      "test-user@example.com",
      "?simulate_type=user&simulate_id=preview-sub",
    );

    const response = await GET(req, context);

    expect(response.status).toBe(403);
    expect(mockFindUser).not.toHaveBeenCalled();
  });
});
