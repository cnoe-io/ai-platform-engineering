/**
 * @jest-environment node
 *
 * Tests for `PATCH`/`DELETE /api/rag/sources/[sourceId]` (spec
 * 2026-07-21-rag-source-config-db, US3 Update/Delete).
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockGetCollection = jest.fn();
const mockRequireResourcePermission = jest.fn();
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
      <T,>(
        handler: (
          request: NextRequest,
          context: { params: Promise<{ sourceId: string }> },
        ) => Promise<T>,
      ) =>
      async (request: NextRequest, context: { params: Promise<{ sourceId: string }> }) => {
        try {
          return await handler(request, context);
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
}));

jest.mock("@/lib/rbac/openfga-owned-resources-reconcile", () => ({
  reconcileIngestionSourceRelationships: (...args: unknown[]) =>
    mockReconcileIngestionSourceRelationships(...args),
}));

function request(method: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL("/api/rag/sources/slack-channel-C1", "http://localhost:3000"), {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}

function params(sourceId = "slack-channel-C1") {
  return { params: Promise.resolve({ sourceId }) };
}

const session = { sub: "alice-sub", role: "user" };
const user = { email: "alice@example.com" };

const baseSource = {
  source_id: "slack-channel-C1",
  source_type: "slack_channel",
  channel_id: "C1",
  name: "eng-general",
  description: "",
  status: "pending",
  default_chunk_size: 10000,
  default_chunk_overlap: 2000,
  reload_interval: 86400,
  config_driven: false,
  config_import_adopted: false,
  visibility: "team",
  owner_team_slug: "platform",
  shared_with_teams: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("PATCH /api/rag/sources/[sourceId]", () => {
  let sources: { findOne: jest.Mock; findOneAndUpdate: jest.Mock; deleteOne: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user, session });
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockReconcileIngestionSourceRelationships.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
    sources = {
      findOne: jest.fn().mockResolvedValue({ ...baseSource }),
      findOneAndUpdate: jest.fn().mockImplementation(async (_filter, update) => ({
        ...baseSource,
        ...update.$set,
      })),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    mockGetCollection.mockResolvedValue(sources);
  });

  // T040
  it("applies mutable fields for an owner-team member and returns the updated record", async () => {
    const { PATCH } = await import("../route");

    const response = await PATCH(
      request("PATCH", { description: "Updated description", default_chunk_size: 5000 }),
      params(),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toMatchObject({ description: "Updated description", default_chunk_size: 5000 });
  });

  // T041
  it("returns 400 IMMUTABLE_FIELD_CHANGE and does not apply any field when an immutable field is present", async () => {
    const { PATCH } = await import("../route");

    const response = await PATCH(
      request("PATCH", { description: "Updated description", channel_id: "C999" }),
      params(),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe("IMMUTABLE_FIELD_CHANGE");
    expect(sources.findOneAndUpdate).not.toHaveBeenCalled();
  });

  // T042 (PATCH half)
  it("returns 403 FORBIDDEN_MANAGE for a caller without can_manage", async () => {
    mockRequireResourcePermission.mockRejectedValue(new Error("denied"));
    const { PATCH } = await import("../route");

    const response = await PATCH(request("PATCH", { description: "x" }), params());
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.code).toBe("FORBIDDEN_MANAGE");
    expect(sources.findOneAndUpdate).not.toHaveBeenCalled();
  });

  // T044
  it("reconciles shared_with_teams before/after lists when changed", async () => {
    sources.findOne.mockResolvedValue({ ...baseSource, shared_with_teams: ["sre"] });
    const { PATCH } = await import("../route");

    await PATCH(request("PATCH", { shared_with_teams: ["sre", "ops"] }), params());

    expect(mockReconcileIngestionSourceRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "slack-channel-C1",
        nextSharedTeamSlugs: ["sre", "ops"],
        previousSharedTeamSlugs: ["sre"],
      }),
    );
  });

  // T046
  it("returns 403 CONFIG_DRIVEN_IMMUTABLE before the can_manage check, even for an owner-team admin", async () => {
    sources.findOne.mockResolvedValue({ ...baseSource, config_driven: true });
    const { PATCH } = await import("../route");

    const response = await PATCH(request("PATCH", { description: "x" }), params());
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.code).toBe("CONFIG_DRIVEN_IMMUTABLE");
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/rag/sources/[sourceId]", () => {
  let sources: { findOne: jest.Mock; deleteOne: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user, session });
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockReconcileIngestionSourceRelationships.mockResolvedValue({ enabled: true, writes: 0, deletes: 1 });
    sources = {
      findOne: jest.fn().mockResolvedValue({ ...baseSource }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    mockGetCollection.mockResolvedValue(sources);
  });

  // T042 (DELETE half)
  it("returns 403 FORBIDDEN_MANAGE for a shared-team (reader-only) caller", async () => {
    mockRequireResourcePermission.mockRejectedValue(new Error("denied"));
    const { DELETE } = await import("../route");

    const response = await DELETE(request("DELETE"), params());
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.code).toBe("FORBIDDEN_MANAGE");
    expect(sources.deleteOne).not.toHaveBeenCalled();
  });

  // T043
  it("returns 409 SOURCE_LOCKED for a record with status ingesting", async () => {
    sources.findOne.mockResolvedValue({ ...baseSource, status: "ingesting" });
    const { DELETE } = await import("../route");

    const response = await DELETE(request("DELETE"), params());
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.code).toBe("SOURCE_LOCKED");
    expect(sources.deleteOne).not.toHaveBeenCalled();
  });

  // T045
  it("removes the Mongo document and reconciles tuple removal on success", async () => {
    const { DELETE } = await import("../route");

    const response = await DELETE(request("DELETE"), params());

    expect(response.status).toBe(200);
    expect(sources.deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({ source_id: "slack-channel-C1" }),
    );
    expect(mockReconcileIngestionSourceRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "slack-channel-C1",
        nextSharedTeamSlugs: [],
      }),
    );
  });

  // T047
  it("returns 403 CONFIG_DRIVEN_IMMUTABLE before the can_manage check", async () => {
    sources.findOne.mockResolvedValue({ ...baseSource, config_driven: true });
    const { DELETE } = await import("../route");

    const response = await DELETE(request("DELETE"), params());
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.code).toBe("CONFIG_DRIVEN_IMMUTABLE");
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    expect(sources.deleteOne).not.toHaveBeenCalled();
  });
});
