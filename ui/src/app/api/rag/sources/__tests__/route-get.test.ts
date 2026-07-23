/**
 * @jest-environment node
 *
 * Tests for `GET /api/rag/sources` (spec 2026-07-21-rag-source-config-db,
 * US2 List/Read).
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockGetCollection = jest.fn();
const mockFilterResourcesByPermission = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public statusCode = 500,
      public code?: string,
    ) {
      super(message);
    }
  }

  return {
    ApiError,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
    successResponse: (data: unknown, status = 200) => Response.json({ success: true, data }, { status }),
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
              code: (error as { code?: string }).code,
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

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: jest.fn(),
  filterResourcesByPermission: (...args: unknown[]) => mockFilterResourcesByPermission(...args),
}));

jest.mock("@/lib/rbac/openfga-owned-resources-reconcile", () => ({
  reconcileIngestionSourceRelationships: jest.fn(),
}));

jest.mock("@/lib/rbac/organization", () => ({
  caipeOrgKey: () => "caipe",
}));

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

const session = { sub: "alice-sub", role: "user" };
const user = { email: "alice@example.com" };

const teamARecord = {
  source_id: "slack-channel-team-a",
  source_type: "slack_channel",
  owner_team_slug: "team-a",
  shared_with_teams: [],
  visibility: "team",
};
const teamASharedRecord = {
  source_id: "slack-channel-shared",
  source_type: "slack_channel",
  owner_team_slug: "team-b",
  shared_with_teams: ["team-a"],
  visibility: "team",
};
const teamBOnlyRecord = {
  source_id: "slack-channel-team-b",
  source_type: "slack_channel",
  owner_team_slug: "team-b",
  shared_with_teams: [],
  visibility: "team",
};
const globalRecord = {
  source_id: "web-url-global",
  source_type: "web_url",
  owner_team_slug: "team-c",
  shared_with_teams: [],
  visibility: "global",
};

describe("GET /api/rag/sources", () => {
  let sources: { find: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user, session });

    sources = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([teamARecord, teamASharedRecord, teamBOnlyRecord]),
      }),
    };
    mockGetCollection.mockResolvedValue(sources);
  });

  // T032
  it("returns exactly the owned + shared records for a Team A member, excluding Team B-only records", async () => {
    mockFilterResourcesByPermission.mockImplementation(async (_session, items: typeof teamARecord[]) =>
      items.filter((item) => item.owner_team_slug === "team-a" || item.shared_with_teams.includes("team-a")),
    );
    const { GET } = await import("../route");

    const response = await GET(request("/api/rag/sources"));
    const json = await response.json();

    expect(json.data.sources.map((s: { source_id: string }) => s.source_id)).toEqual([
      "slack-channel-team-a",
      "slack-channel-shared",
    ]);
  });

  // T033
  it("returns all records for an org admin (filter is a no-op bypass)", async () => {
    mockFilterResourcesByPermission.mockImplementation(async (_session, items) => items);
    const { GET } = await import("../route");

    const response = await GET(request("/api/rag/sources"));
    const json = await response.json();

    expect(json.data.sources).toHaveLength(3);
    expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
      session,
      expect.anything(),
      expect.objectContaining({ type: "ingestion_source", action: "read" }),
      { bypassForOrgAdmin: true },
    );
  });

  // T034
  it("includes a visibility:global record for a caller with no team relationship to it", async () => {
    sources.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([globalRecord]),
    });
    // filterResourcesByPermission delegates to OpenFGA can_read, which the
    // user:* wildcard on a global record satisfies for any caller — the
    // route itself does no extra branching (contract T038).
    mockFilterResourcesByPermission.mockImplementation(async (_session, items) => items);
    const { GET } = await import("../route");

    const response = await GET(request("/api/rag/sources"));
    const json = await response.json();

    expect(json.data.sources.map((s: { source_id: string }) => s.source_id)).toEqual(["web-url-global"]);
  });

  // T037
  it("filters the list by source_type query param", async () => {
    mockFilterResourcesByPermission.mockImplementation(async (_session, items) => items);
    const { GET } = await import("../route");

    await GET(request("/api/rag/sources?source_type=web_url"));

    expect(sources.find).toHaveBeenCalledWith(expect.objectContaining({ source_type: "web_url" }));
  });
});
