/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api-error";

const mockGetAuth = jest.fn();
const mockRequireAdminSurfaceManage = jest.fn();
const mockRequireBaselineAdminSurfaceRead = jest.fn();
const mockHasOrganizationAdmin = jest.fn();
const mockResolveSimulationScope = jest.fn();
const mockSimulationCanManage = jest.fn();
const mockSimulationCanAudit = jest.fn();
const mockGetReadableSlackChannelNames = jest.fn();
const mockGetOwnedAgents = jest.fn();
const mockGetOwnedAgentConversationIds = jest.fn();
const mockGetInsightsActorTeamSlugs = jest.fn();
const mockLoadTeamMembersForSlugs = jest.fn();
const mockFindUser = jest.fn();
const mockFindConversations = jest.fn();
const mockCountConversations = jest.fn();
const mockAggregateFeedback = jest.fn();
const mockFindFeedback = jest.fn();
const mockAggregateMessages = jest.fn();
const mockGetRealmUserById = jest.fn();
let messageRows: Record<string, unknown>[] = [];

let mongoConfigured = true;

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuth(...args),
  };
});

jest.mock("@/lib/rbac/admin-simulation-server", () => ({
  resolveAuthorizedAdminSimulationScope: (...args: unknown[]) =>
    mockResolveSimulationScope(...args),
  simulationSubjectCanManageAdminSurface: (...args: unknown[]) =>
    mockSimulationCanManage(...args),
  simulationSubjectCanAuditOrganization: (...args: unknown[]) =>
    mockSimulationCanAudit(...args),
}));

jest.mock("@/lib/rbac/platform-admin", () => ({
  hasOrganizationAdmin: (...args: unknown[]) =>
    mockHasOrganizationAdmin(...args),
}));

jest.mock("@/lib/rbac/require-openfga", () => ({
  requireAdminSurfaceManage: (...args: unknown[]) =>
    mockRequireAdminSurfaceManage(...args),
  requireBaselineAdminSurfaceRead: (...args: unknown[]) =>
    mockRequireBaselineAdminSurfaceRead(...args),
}));

jest.mock("@/lib/rbac/user-insights-scope", () => ({
  getReadableSlackChannelNames: (...args: unknown[]) =>
    mockGetReadableSlackChannelNames(...args),
  getOwnedAgents: (...args: unknown[]) => mockGetOwnedAgents(...args),
  getOwnedAgentConversationIds: (...args: unknown[]) =>
    mockGetOwnedAgentConversationIds(...args),
  getInsightsActorTeamSlugs: (...args: unknown[]) =>
    mockGetInsightsActorTeamSlugs(...args),
}));

jest.mock("@/lib/rbac/team-membership-store", () => ({
  loadTeamMembersForSlugs: (...args: unknown[]) =>
    mockLoadTeamMembersForSlugs(...args),
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
    if (name === "messages") {
      return {
        aggregate: (...args: unknown[]) => {
          mockAggregateMessages(...args);
          return { toArray: async () => messageRows };
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
  messageRows = [];
  mockGetAuth.mockResolvedValue({
    session: {
      sub: "admin-sub",
      user: { email: "admin@example.com" },
    },
  });
  mockRequireAdminSurfaceManage.mockResolvedValue(undefined);
  mockRequireBaselineAdminSurfaceRead.mockResolvedValue(undefined);
  mockHasOrganizationAdmin.mockResolvedValue(true);
  mockResolveSimulationScope.mockResolvedValue(null);
  mockSimulationCanManage.mockResolvedValue(true);
  mockSimulationCanAudit.mockResolvedValue(true);
  mockGetReadableSlackChannelNames.mockResolvedValue([]);
  mockGetOwnedAgents.mockResolvedValue([]);
  mockGetOwnedAgentConversationIds.mockResolvedValue({ ids: [], capped: false });
  mockGetInsightsActorTeamSlugs.mockResolvedValue([]);
  mockLoadTeamMembersForSlugs.mockResolvedValue(new Map());
  mockFindUser.mockResolvedValue({
    email: "test-user@example.com",
    name: "Test User",
    keycloak_sub: "target-sub",
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
        idempotency_key: "1775100000.123456",
        metadata: {
          channel_id: "C123TEST",
          channel_name: "example-channel",
          thread_ts: "1775100000.123456",
          workspace_url: "https://example.slack.com",
        },
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
  it("rejects callers who cannot read the Insights surface", async () => {
    mockRequireAdminSurfaceManage.mockRejectedValue(new Error("not manager"));
    mockHasOrganizationAdmin.mockResolvedValue(false);
    mockRequireBaselineAdminSurfaceRead.mockRejectedValue(
      new ApiError(
        "You do not have permission to view this read-only dashboard surface.",
        403,
      ),
    );
    const { GET } = await import("../route");
    const { request: req,context } = request("test-user@example.com");

    const response = await GET(req, context);

    expect(response.status).toBe(403);
    expect(mockRequireBaselineAdminSurfaceRead).toHaveBeenCalledWith(
      {
        sub: "admin-sub",
        user: { email: "admin@example.com" },
      },
      "stats",
    );
    expect(mockFindUser).not.toHaveBeenCalled();
  });

  it("loads activity by analytics identity without treating the email as a Keycloak id", async () => {
    const { GET } = await import("../route");
    const { request: req,context } = request("test-user@example.com");

    const response = await GET(req, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireAdminSurfaceManage).toHaveBeenCalledWith(
      {
        sub: "admin-sub",
        user: { email: "admin@example.com" },
      },
      "stats",
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
          slack_permalink:
            "https://example.slack.com/archives/C123TEST/p1775100000123456",
        },
      ],
      can_view_conversations: true,
    });
  });

  it("opens an admin drawer for an identity represented only by message analytics", async () => {
    mockFindUser.mockResolvedValue(null);
    mockFindConversations
      .mockReset()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);
    mockCountConversations.mockResolvedValue(0);
    mockAggregateFeedback
      .mockReset()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);
    mockFindFeedback
      .mockReset()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);
    messageRows = [{ _id: "message-1" }];

    const { GET } = await import("../route");
    const { request: req,context } = request("message-user@example.com");
    const response = await GET(req, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockAggregateMessages).toHaveBeenCalled();
    expect(body.data.profile).toMatchObject({
      email: "message-user@example.com",
      name: "message-user@example.com",
    });
  });

  it("lets a scoped teammate view scoped overview/feedback but never conversation rows", async () => {
    mockGetAuth.mockResolvedValue({
      session: {
        sub: "member-sub",
        user: { email: "member@example.com" },
      },
    });
    mockRequireAdminSurfaceManage.mockRejectedValue(new Error("not manager"));
    mockHasOrganizationAdmin.mockResolvedValue(false);
    mockGetReadableSlackChannelNames.mockResolvedValue(["example-channel"]);
    mockGetOwnedAgents.mockResolvedValue([
      { id: "agent-owned", name: "Owned Agent" },
    ]);
    mockGetOwnedAgentConversationIds.mockResolvedValue({
      ids: ["conversation-1"],
      capped: false,
    });
    mockGetInsightsActorTeamSlugs.mockResolvedValue(["primary"]);
    mockLoadTeamMembersForSlugs.mockResolvedValue(new Map([
      ["primary", [{
        identity_key: "target-sub",
        user_subject: "target-sub",
        user_email: "test-user@example.com",
        role: "member",
        source_types: ["manual"],
        provider_ids: [],
      }]],
    ]));

    const { GET } = await import("../route");
    const { request: req,context } = request("test-user@example.com");
    const response = await GET(req, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireBaselineAdminSurfaceRead).toHaveBeenCalledWith(
      {
        sub: "member-sub",
        user: { email: "member@example.com" },
      },
      "stats",
    );
    expect(body.data.can_view_conversations).toBe(false);
    expect(body.data.recent_conversations).toEqual([]);
    expect(body.data.recent_feedback).toEqual([
      expect.objectContaining({
        conversation_id: null,
        slack_permalink: null,
      }),
    ]);
    // The server does not even fetch conversation titles for scoped viewers.
    expect(mockFindConversations).not.toHaveBeenCalled();
    expect(mockCountConversations).toHaveBeenCalledWith({
      $and: [
        {
          owner_id: {
            $in: expect.arrayContaining([
              "test-user@example.com",
              "U123TEST",
            ]),
          },
        },
        {
          $or: expect.arrayContaining([
            expect.objectContaining({
              $and: expect.any(Array),
            }),
            { owner_id: "member@example.com" },
          ]),
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
    mockSimulationCanAudit.mockResolvedValue(false);
    mockCountConversations.mockResolvedValue(0);
    mockAggregateFeedback
      .mockReset()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);
    mockFindFeedback
      .mockReset()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);
    const { GET } = await import("../route");
    const { request: req,context } = request(
      "test-user@example.com",
      "?simulate_type=user&simulate_id=preview-sub",
    );

    const response = await GET(req, context);

    expect(response.status).toBe(403);
    expect(mockRequireBaselineAdminSurfaceRead).not.toHaveBeenCalled();
    expect(mockFindConversations).not.toHaveBeenCalled();
  });
});
