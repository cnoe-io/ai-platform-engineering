/**
 * @jest-environment node
 */
/**
 * Integration tests for /api/rag/kbs/[id]/sharing.
 *
 * Covers the KB sharing route contract:
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
  // Real ApiError so the route's `instanceof ApiError` matches errors thrown
  // by shared modules (shareable-resource.ts → @/lib/api-error). Production
  // api-middleware re-exports this same class.
  const { ApiError } = jest.requireActual("@/lib/api-error");
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
const mockCanTransferResourceOwnership = jest.fn();
jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
  canTransferResourceOwnership: (...args: unknown[]) =>
    mockCanTransferResourceOwnership(...args),
}));

const mockReconcileKnowledgeBaseRelationships = jest.fn();
const mockReconcileDataSourceRelationships = jest.fn();
jest.mock("@/lib/rbac/openfga-owned-resources", () => ({
  reconcileKnowledgeBaseRelationships: (...args: unknown[]) =>
    mockReconcileKnowledgeBaseRelationships(...args),
  reconcileDataSourceRelationships: (...args: unknown[]) =>
    mockReconcileDataSourceRelationships(...args),
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
    mockCanTransferResourceOwnership.mockResolvedValue(true);
    mockReconcileKnowledgeBaseRelationships.mockResolvedValue({
      enabled: true,
      writes: 2,
      deletes: 0,
    });
    mockReconcileDataSourceRelationships.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
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

    it("returns the real owner_team_slug + creator_subject from the datasource config", async () => {
      // OpenFGA reader tuples include the owner team (platform) + a shared team.
      mockReadOpenFgaTuples.mockResolvedValueOnce({
        tuples: [
          { key: { user: "team:platform#member", relation: "reader", object: "knowledge_base:kb-1" } },
          { key: { user: "team:data-eng#member", relation: "reader", object: "knowledge_base:kb-1" } },
        ],
      });
      // The datasource config (RAG server) is the source of truth for owner.
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            datasources: [
              { datasource_id: "kb-1", owner_team_slug: "platform", creator_subject: "alice-sub" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const res = await GET(makeRequest(), { params: Promise.resolve({ id: "kb-1" }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.owner_team_slug).toBe("platform");
      expect(body.creator_subject).toBe("alice-sub");
      // Owner (platform) is deduped out of the shared list — shown once as owner.
      expect(body.shared_team_slugs).toEqual(["data-eng"]);
      fetchSpy.mockRestore();
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
      // No owner persisted in config (pre-migration datasource).
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ datasources: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

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
          ownerTeamSlug: null,
          nextSharedTeamSlugs: ["data-eng", "ml-ops"],
          previousSharedTeamSlugs: ["legacy-team"],
        }),
      );

      // The data_source inherits the KB grants via the `parent_kb` edge
      // (spec 2026-06-03, US4) — sharing the KB ensures that single
      // inheritance edge exists rather than mirroring per-team tuples.
      expect(mockReconcileDataSourceRelationships).toHaveBeenCalledWith(
        expect.objectContaining({
          dataSourceId: "kb-1",
          parentKnowledgeBaseId: "kb-1",
        }),
      );

      expect(mockRequireResourcePermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: "alice-sub" }),
        { type: "knowledge_base", id: "kb-1", action: "admin" },
        { bypassForOrgAdmin: true },
      );
      fetchSpy.mockRestore();
    });

    it("preserves the owner team's grant when updating shared teams", async () => {
      // OpenFGA reader tuples include the owner team (platform) — because the
      // owner is granted via the same reader/manager pair as a shared team —
      // plus a currently-shared team being removed in this update.
      mockReadOpenFgaTuples.mockResolvedValueOnce({
        tuples: [
          { key: { user: "team:platform#member", relation: "reader", object: "knowledge_base:kb-1" } },
          { key: { user: "team:old-share#member", relation: "reader", object: "knowledge_base:kb-1" } },
        ],
      });
      // Config (source of truth) says platform is the owner team.
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            datasources: [{ datasource_id: "kb-1", owner_team_slug: "platform" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      // Caller shares with data-eng and (redundantly) lists the owner team.
      const res = await PUT(
        makeRequest({ team_slugs: ["data-eng", "platform"] }),
        { params: Promise.resolve({ id: "kb-1" }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      // Owner is deduped out of the shared list in the response.
      expect(body.shared_team_slugs).toEqual(["data-eng"]);

      // The reconciler must receive the owner team so it stays in the desired
      // set; otherwise `platform` (in previous, absent from next) would be
      // revoked — the bug this test guards against. `old-share` IS revoked.
      expect(mockReconcileKnowledgeBaseRelationships).toHaveBeenCalledWith(
        expect.objectContaining({
          knowledgeBaseId: "kb-1",
          ownerTeamSlug: "platform",
          nextSharedTeamSlugs: ["data-eng"],
          previousSharedTeamSlugs: ["old-share", "platform"],
        }),
      );
      fetchSpy.mockRestore();
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

    describe("ownership transfer (US3)", () => {
      // Mock the RAG server: GET /v1/datasources returns the current config
      // (owner = platform); POST /v1/datasource is the owner re-upsert.
      function mockRagConfig(currentOwner: string) {
        return jest.spyOn(global, "fetch").mockImplementation((url: string | URL) => {
          const u = String(url);
          if (u.endsWith("/v1/datasources")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  datasources: [
                    { datasource_id: "kb-1", owner_team_slug: currentOwner, creator_subject: "alice-sub" },
                  ],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            );
          }
          // POST /v1/datasource upsert (owner persist) → 202.
          return Promise.resolve(new Response(null, { status: 202 }));
        });
      }

      it("transfers ownership to a new team when authorized, persisting + revoking the old owner", async () => {
        mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });
        mockCanTransferResourceOwnership.mockResolvedValue(true);
        mockRequireResourcePermission.mockResolvedValue(undefined); // member of destination
        const fetchSpy = mockRagConfig("platform");

        const res = await PUT(
          makeRequest({ owner_team_slug: "data-eng", team_slugs: [] }),
          { params: Promise.resolve({ id: "kb-1" }) },
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.owner_team_slug).toBe("data-eng");
        // Reconcile carried the previous owner so its grants are revoked.
        expect(mockReconcileKnowledgeBaseRelationships).toHaveBeenCalledWith(
          expect.objectContaining({
            knowledgeBaseId: "kb-1",
            ownerTeamSlug: "data-eng",
            previousOwnerTeamSlug: "platform",
          }),
        );
        // Owner was persisted to the datasource config via the upsert.
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining("/v1/datasource"),
          expect.objectContaining({ method: "POST" }),
        );
        fetchSpy.mockRestore();
      });

      it("denies a transfer when the caller is neither owner-team admin nor org admin", async () => {
        mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });
        mockCanTransferResourceOwnership.mockResolvedValue(false);
        const fetchSpy = mockRagConfig("platform");

        const res = await PUT(
          makeRequest({ owner_team_slug: "data-eng" }),
          { params: Promise.resolve({ id: "kb-1" }) },
        );
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.code).toBe("TRANSFER_FORBIDDEN");
        fetchSpy.mockRestore();
      });

      it("requires not-a-member confirmation for a transfer to a team the caller isn't in", async () => {
        mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });
        mockCanTransferResourceOwnership.mockResolvedValue(true);
        // Not a member of the destination team.
        const ApiErrorClass = jest.requireMock("@/lib/api-middleware").ApiError;
        mockRequireResourcePermission.mockImplementation(async (_s: unknown, t: { type: string }) => {
          if (t.type === "team") throw new ApiErrorClass("not a member", 403);
        });
        const fetchSpy = mockRagConfig("platform");

        const res = await PUT(
          makeRequest({ owner_team_slug: "data-eng" }),
          { params: Promise.resolve({ id: "kb-1" }) },
        );
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.code).toBe("TRANSFER_NOT_MEMBER_UNCONFIRMED");
        fetchSpy.mockRestore();
      });
    });
  });
});
