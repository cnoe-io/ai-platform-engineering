/**
 * @jest-environment node
 */
/**
 * Integration tests for /api/rag/kbs/[id]/sharing.
 *
 * Covers PR 3 of the 2026-05-27 fine-grained KB ReBAC plan:
 * - GET requires `knowledge_base#read` and returns the canonical team slugs.
 * - PUT requires `knowledge_base#admin` and calls the reconciler with the
 *   previous + next shared slugs so unchecking a team genuinely deletes
 *   the OpenFGA tuple.
 * - Org admins are still bypassed via `bypassForOrgAdmin: true`.
 * - Invalid request bodies are rejected with 400.
 */

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
}));

const mockRequireRbacPermission = jest.fn();
jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(message: string, public statusCode = 500, public code?: string) {
      super(message);
    }
  }
  return {
    ApiError,
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    handleApiError: (error: unknown) =>
      Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "error",
          code: (error as { code?: string }).code,
        },
        { status: (error as { statusCode?: number }).statusCode ?? 500 },
      ),
  };
});

const mockRequireResourcePermission = jest.fn();
jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

const mockReconcileKnowledgeBaseRelationships = jest.fn();
const mockBuildKnowledgeBaseRelationshipTupleDiff = jest.fn();
jest.mock("@/lib/rbac/openfga-owned-resources", () => ({
  reconcileKnowledgeBaseRelationships: (...args: unknown[]) =>
    mockReconcileKnowledgeBaseRelationships(...args),
  buildKnowledgeBaseRelationshipTupleDiff: (...args: unknown[]) =>
    mockBuildKnowledgeBaseRelationshipTupleDiff(...args),
}));

const mockReadOpenFgaTuples = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
}));

import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/rag/kbs/[id]/sharing/route";

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/rag/kbs/kb-1/sharing", {
    method: body === undefined ? "GET" : "PUT",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("/api/rag/kbs/[id]/sharing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireRbacPermission.mockResolvedValue(undefined);
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockReconcileKnowledgeBaseRelationships.mockResolvedValue({
      enabled: true,
      writes: 2,
      deletes: 0,
    });
    mockBuildKnowledgeBaseRelationshipTupleDiff.mockReturnValue({ writes: [], deletes: [] });
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });
    (getServerSession as jest.Mock).mockResolvedValue({
      accessToken: "tok",
      sub: "alice-sub",
      org: "caipe",
      user: { email: "alice@example.com" },
    });
  });

  describe("GET", () => {
    it("returns 401 when no session", async () => {
      (getServerSession as jest.Mock).mockResolvedValue(null);
      const res = await GET(makeRequest(), { params: Promise.resolve({ id: "kb-1" }) });
      expect(res.status).toBe(401);
    });

    it("rejects invalid kb id", async () => {
      const res = await GET(makeRequest(), { params: Promise.resolve({ id: "..bad..!" }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("INVALID_KB_ID");
    });

    it("returns canonical shared team slugs from OpenFGA reader tuples", async () => {
      mockReadOpenFgaTuples.mockResolvedValueOnce({
        tuples: [
          { key: { user: "team:platform#member", relation: "reader", object: "knowledge_base:kb-1" } },
          { key: { user: "team:data-eng#member", relation: "reader", object: "knowledge_base:kb-1" } },
          { key: { user: "team:platform#admin", relation: "manager", object: "knowledge_base:kb-1" } },
          { key: { user: "user:alice-sub", relation: "owner", object: "knowledge_base:kb-1" } },
        ],
      });

      const res = await GET(makeRequest(), { params: Promise.resolve({ id: "kb-1" }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.knowledge_base_id).toBe("kb-1");
      expect(body.shared_team_slugs).toEqual(["data-eng", "platform"]);
      expect(mockRequireResourcePermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: "alice-sub" }),
        { type: "knowledge_base", id: "kb-1", action: "read" },
        { bypassForOrgAdmin: true },
      );
    });
  });

  describe("PUT", () => {
    it("normalizes input and forwards previous + next slugs to the reconciler", async () => {
      mockReadOpenFgaTuples.mockResolvedValueOnce({
        tuples: [
          { key: { user: "team:legacy-team#member", relation: "reader", object: "knowledge_base:kb-1" } },
          { key: { user: "team:legacy-team#admin", relation: "manager", object: "knowledge_base:kb-1" } },
        ],
      });

      const res = await PUT(
        makeRequest({ team_slugs: ["data-eng", "", "ml-ops", "data-eng"] }),
        { params: Promise.resolve({ id: "kb-1" }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.shared_team_slugs).toEqual(["data-eng", "ml-ops"]);

      expect(mockReconcileKnowledgeBaseRelationships).toHaveBeenCalledWith(
        expect.objectContaining({
          knowledgeBaseId: "kb-1",
          nextSharedTeamSlugs: ["data-eng", "ml-ops"],
          previousSharedTeamSlugs: ["legacy-team"],
        }),
      );

      expect(mockRequireResourcePermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: "alice-sub" }),
        { type: "knowledge_base", id: "kb-1", action: "admin" },
        { bypassForOrgAdmin: true },
      );
    });

    it("rejects malformed JSON bodies", async () => {
      const req = new NextRequest("http://localhost/api/rag/kbs/kb-1/sharing", {
        method: "PUT",
        body: "not json",
        headers: { "content-type": "application/json" },
      });
      const res = await PUT(req, { params: Promise.resolve({ id: "kb-1" }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("INVALID_JSON");
    });

    it("rejects array body (must be object with team_slugs)", async () => {
      const res = await PUT(makeRequest(["x"]), { params: Promise.resolve({ id: "kb-1" }) });
      expect(res.status).toBe(400);
    });

    it("rejects when caller lacks knowledge_base#admin", async () => {
      const ApiErrorClass = jest.requireMock("@/lib/api-middleware").ApiError;
      mockRequireResourcePermission.mockRejectedValueOnce(
        new ApiErrorClass("forbidden", 403, "FORBIDDEN"),
      );
      const res = await PUT(makeRequest({ team_slugs: ["x"] }), {
        params: Promise.resolve({ id: "kb-1" }),
      });
      expect(res.status).toBe(403);
    });
  });
});
