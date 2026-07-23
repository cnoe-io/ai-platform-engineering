/**
 * @jest-environment node
 *
 * Tests for `POST /api/rag/sources` (spec 2026-07-21-rag-source-config-db,
 * US1 Create). Mirrors the RBAC route test style used by
 * `ui/src/app/api/dynamic-agents/__tests__/route-rbac.test.ts`.
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockGetCollection = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockFilterResourcesByPermission = jest.fn();
const mockReconcileIngestionSourceRelationships = jest.fn();

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
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
  filterResourcesByPermission: (...args: unknown[]) => mockFilterResourcesByPermission(...args),
}));

jest.mock("@/lib/rbac/openfga-owned-resources-reconcile", () => ({
  reconcileIngestionSourceRelationships: (...args: unknown[]) =>
    mockReconcileIngestionSourceRelationships(...args),
}));

jest.mock("@/lib/rbac/organization", () => ({
  caipeOrgKey: () => "caipe",
}));

function request(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

const session = { sub: "alice-sub", role: "user" };
const user = { email: "alice@example.com" };

function postBody(overrides: Record<string, unknown> = {}) {
  return {
    source_type: "slack_channel",
    channel_id: "C1234567890",
    name: "eng-general",
    owner_team_slug: "platform",
    ...overrides,
  };
}

describe("POST /api/rag/sources", () => {
  let sources: { findOne: jest.Mock; insertOne: jest.Mock };
  let teams: { findOne: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user, session });
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockReconcileIngestionSourceRelationships.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });

    sources = { findOne: jest.fn().mockResolvedValue(null), insertOne: jest.fn().mockResolvedValue({}) };
    teams = { findOne: jest.fn().mockResolvedValue({ _id: "team-id", slug: "platform" }) };
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "rag_ingestion_sources") return sources;
      if (name === "teams") return teams;
      throw new Error(`unexpected collection ${name}`);
    });
  });

  // T023
  it("creates a slack_channel source with correct source_id, config_driven false, visibility team", async () => {
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/rag/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody()),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.data).toMatchObject({
      source_id: "slack-channel-C1234567890",
      source_type: "slack_channel",
      config_driven: false,
      config_import_adopted: false,
      visibility: "team",
      owner_team_slug: "platform",
      status: "pending",
    });
    expect(sources.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ source_id: "slack-channel-C1234567890" }),
    );
  });

  // T024
  it("returns 409 SOURCE_ALREADY_EXISTS for a duplicate channel_id", async () => {
    sources.findOne.mockResolvedValue({ source_id: "slack-channel-C1234567890" });
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/rag/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody()),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.code).toBe("SOURCE_ALREADY_EXISTS");
    expect(sources.insertOne).not.toHaveBeenCalled();
  });

  // T025
  it("returns 403 FORBIDDEN_OWNER_TEAM when the caller is not a member of owner_team_slug", async () => {
    mockRequireResourcePermission.mockRejectedValue(new Error("denied"));
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/rag/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody()),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.code).toBe("FORBIDDEN_OWNER_TEAM");
    expect(sources.insertOne).not.toHaveBeenCalled();
  });

  // T026
  it("returns 404 OWNER_TEAM_NOT_FOUND for an unknown owner_team_slug", async () => {
    teams.findOne.mockResolvedValue(null);
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/rag/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody({ owner_team_slug: "no-such-team" })),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.code).toBe("OWNER_TEAM_NOT_FOUND");
    expect(sources.insertOne).not.toHaveBeenCalled();
  });

  // T027 — source_id formula per source_type
  it.each([
    [
      postBody({ source_type: "confluence_space", channel_id: undefined, confluence_url: "https://example.atlassian.net/wiki", space_key: "ENG" }),
      "src_confluence___example_atlassian_net__ENG",
    ],
    [
      postBody({ source_type: "jira_project", channel_id: undefined, project_key: "SDPL", source_slug: "eng-board", jql: "project = SDPL" }),
      "jira-sdpl-eng-board",
    ],
    [
      postBody({ source_type: "web_url", channel_id: undefined, url: "https://example.com/docs" }),
      null, // hash-based; asserted via regex below instead of exact match
    ],
    [
      postBody({ source_type: "webex_space", channel_id: undefined, space_id: "space-123" }),
      "webex-space-space-123",
    ],
  ])("computes the documented source_id formula for %#", async (body, expectedId) => {
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/rag/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    if (expectedId) {
      expect(json.data.source_id).toBe(expectedId);
    } else {
      expect(json.data.source_id).toMatch(/^src_https___example_com_docs_[a-f0-9]{12}$/);
    }
  });

  // T028
  it("returns 400 INVALID_SOURCE_PAYLOAD when a required type-specific field is missing", async () => {
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/rag/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          postBody({ source_type: "confluence_space", channel_id: undefined, confluence_url: "https://example.atlassian.net/wiki" }),
        ),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe("INVALID_SOURCE_PAYLOAD");
    expect(sources.insertOne).not.toHaveBeenCalled();
  });

  // T029
  it("reconciles owner-team tuples without a user:* wildcard when visibility defaults to team", async () => {
    const { POST } = await import("../route");

    await POST(
      request("/api/rag/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody()),
      }),
    );

    expect(mockReconcileIngestionSourceRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "slack-channel-C1234567890",
        ownerTeamSlug: "platform",
        globalUserAccess: false,
      }),
    );
  });

  // T030
  it("ignores caller-supplied config_driven/visibility and always produces config_driven:false, visibility:team", async () => {
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/rag/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody({ config_driven: true, visibility: "global" })),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.data.config_driven).toBe(false);
    expect(json.data.visibility).toBe("team");
    expect(mockReconcileIngestionSourceRelationships).toHaveBeenCalledWith(
      expect.objectContaining({ globalUserAccess: false }),
    );
  });
});
