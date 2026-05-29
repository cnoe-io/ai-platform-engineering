/**
 * @jest-environment node
 */

import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockCollections: Record<string, any> = {};

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 500) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    ApiError,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    successResponse: (data: unknown) => NextResponse.json({ success: true, data }),
    withErrorHandler:
      (handler: (...args: any[]) => Promise<Response>) =>
      async (...args: any[]) => {
        try {
          return await handler(...args);
        } catch (error) {
          return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "error" },
            { status: error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 500 }
          );
        }
      },
  };
});

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) => mockCollections[name] ?? createMockCollection([])),
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

/**
 * Minimal MongoDB-filter shim. Supports the shapes used by route
 * handlers under test:
 *   - equality:               { team_slug: "x" }
 *   - object id equality:     { _id: <ObjectId> }
 *   - $or with sub-filters:   { $or: [{user_email: ...}, ...] }
 *   - $ne:                    { status: { $ne: "removed" } }
 *   - $in:                    { slug: { $in: [...] } }
 */
function matchesFilter(row: any, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or" && Array.isArray(value)) {
      return value.some((clause: Record<string, any>) => matchesFilter(row, clause));
    }
    if (value instanceof ObjectId) return String(row[key]) === String(value);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if ("$ne" in value) return row[key] !== value.$ne;
      if ("$in" in value) return Array.isArray(value.$in) && value.$in.includes(row[key]);
    }
    return row[key] === value;
  });
}

function createMockCollection(rows: any[]) {
  // Cursor must support `find().toArray()` so the canonical
  // team-membership reader (post 2026-05-26 canonical-membership refactor)
  // can resolve the calling user's role for KB-permission gates.
  return {
    rows,
    findOne: jest.fn(async (filter: Record<string, any>) => rows.find((row) => matchesFilter(row, filter)) ?? null),
    find: jest.fn((filter: Record<string, any> = {}) => ({
      toArray: jest.fn(async () => rows.filter((row) => matchesFilter(row, filter))),
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn(async () => rows.filter((row) => matchesFilter(row, filter))),
      }),
    })),
    updateOne: jest.fn(async (filter: Record<string, any>, update: any, options?: any) => {
      const row = rows.find((candidate) => matchesFilter(candidate, filter));
      if (row && update.$set) Object.assign(row, update.$set);
      if (!row && options?.upsert) rows.push({ ...filter, ...(update.$set ?? {}) });
      return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0, upsertedCount: row ? 0 : 1 };
    }),
  };
}

function request(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

const teamId = new ObjectId();

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockGetAuthFromBearerOrSession.mockResolvedValue({
    user: { email: "admin@example.com", role: "admin" },
    session: { user: { email: "admin@example.com" }, role: "admin" },
  });
  mockRequireRbacPermission.mockResolvedValue(undefined);
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
  mockCollections.teams = createMockCollection([
    { _id: teamId, slug: "platform", name: "Platform" },
  ]);
  mockCollections.team_kb_ownership = createMockCollection([]);
});

describe("/api/admin/teams/[id]/kb-assignments", () => {
  it("falls back to legacy team resource KB assignments when ownership rows are missing", async () => {
    mockCollections.teams = createMockCollection([
      {
        _id: teamId,
        slug: "platform",
        name: "Platform",
        resources: {
          knowledge_bases: ["legacy-ds"],
        },
      },
    ]);
    mockCollections.team_kb_ownership = createMockCollection([]);
    const { GET } = await import("../route");

    const response = await GET(
      request(`/api/admin/teams/${teamId}/kb-assignments`),
      { params: Promise.resolve({ id: String(teamId) }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.kb_ids).toEqual(["legacy-ds"]);
    expect(body.data.kb_permissions).toEqual({ "legacy-ds": "read" });
    expect(body.data.allowed_datasource_ids).toEqual(["legacy-ds"]);
  });

  it("reconciles knowledge-base tuples before saving assignments", async () => {
    mockCollections.team_kb_ownership = createMockCollection([
      {
        team_id: String(teamId),
        kb_ids: ["old-ds"],
        allowed_datasource_ids: ["old-ds"],
        kb_permissions: { "old-ds": "read" },
      },
    ]);
    const { PUT } = await import("../route");

    const response = await PUT(
      request(`/api/admin/teams/${teamId}/kb-assignments`, {
        method: "PUT",
        body: JSON.stringify({
          kb_ids: ["new-read-ds", "new-ingest-ds", "new-admin-ds"],
          kb_permissions: {
            "new-read-ds": "read",
            "new-ingest-ds": "ingest",
            "new-admin-ds": "admin",
          },
        }),
      }),
      { params: Promise.resolve({ id: String(teamId) }) }
    );

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [
        { user: "team:platform#member", relation: "reader", object: "knowledge_base:new-read-ds" },
        { user: "team:platform#member", relation: "ingestor", object: "knowledge_base:new-ingest-ds" },
        { user: "team:platform#admin", relation: "manager", object: "knowledge_base:new-admin-ds" },
      ],
      deletes: [
        { user: "team:platform#member", relation: "reader", object: "knowledge_base:old-ds" },
      ],
    });
    expect(mockCollections.team_kb_ownership.updateOne).toHaveBeenCalled();
  });

  it("removes the OpenFGA tuple before deleting a KB assignment", async () => {
    mockCollections.team_kb_ownership = createMockCollection([
      {
        team_id: String(teamId),
        kb_ids: ["old-ds"],
        allowed_datasource_ids: ["old-ds"],
        kb_permissions: { "old-ds": "ingest" },
      },
    ]);
    const { DELETE } = await import("../route");

    const response = await DELETE(
      request(`/api/admin/teams/${teamId}/kb-assignments?datasource_id=old-ds`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: String(teamId) }) }
    );

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [],
      deletes: [
        { user: "team:platform#member", relation: "ingestor", object: "knowledge_base:old-ds" },
      ],
    });
  });

  it("repairs missing OpenFGA tuples when saving an unchanged Mongo assignment", async () => {
    mockCollections.team_kb_ownership = createMockCollection([
      {
        team_id: String(teamId),
        kb_ids: ["existing-ds"],
        allowed_datasource_ids: ["existing-ds"],
        kb_permissions: { "existing-ds": "read" },
      },
    ]);
    const { PUT } = await import("../route");

    const response = await PUT(
      request(`/api/admin/teams/${teamId}/kb-assignments`, {
        method: "PUT",
        body: JSON.stringify({
          kb_ids: ["existing-ds"],
          kb_permissions: { "existing-ds": "read" },
        }),
      }),
      { params: Promise.resolve({ id: String(teamId) }) }
    );

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [
        { user: "team:platform#member", relation: "reader", object: "knowledge_base:existing-ds" },
      ],
      deletes: [],
    });
  });

  it("allows a scoped team admin to manage their team's KB assignments", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "lead@example.com", role: "user" },
      session: { user: { email: "lead@example.com" }, role: "user" },
    });
    mockRequireRbacPermission.mockImplementation(async (_session, resource, scope) => {
      if (resource === "admin_ui" || (resource === "team" && scope === "manage")) {
        const error = new Error("not platform admin") as Error & { statusCode: number };
        error.statusCode = 403;
        throw error;
      }
    });
    mockCollections.teams = createMockCollection([
      {
        _id: teamId,
        slug: "platform",
        name: "Platform",
      },
    ]);
    // Post-canonical-membership refactor: scoped-admin gate reads from
    // team_membership_sources, not team.members[].
    mockCollections.team_membership_sources = createMockCollection([
      {
        team_slug: "platform",
        user_email: "lead@example.com",
        relationship: "admin",
        source_type: "manual",
        status: "active",
      },
    ]);
    const { PUT } = await import("../route");

    const response = await PUT(
      request(`/api/admin/teams/${teamId}/kb-assignments`, {
        method: "PUT",
        body: JSON.stringify({
          kb_ids: ["team-ds"],
          kb_permissions: { "team-ds": "admin" },
        }),
      }),
      { params: Promise.resolve({ id: String(teamId) }) }
    );

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [
        { user: "team:platform#admin", relation: "manager", object: "knowledge_base:team-ds" },
      ],
      deletes: [],
    });
  });
});
