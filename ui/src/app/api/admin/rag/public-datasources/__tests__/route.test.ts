/**
 * @jest-environment node
 */
/**
 * Tests for /api/admin/rag/public-datasources.
 *
 * - GET reports public state from the data_source wildcard reader tuple.
 * - POST {public:true} writes `user:* reader` on BOTH knowledge_base and
 *   data_source so the datasource is both discoverable and queryable.
 * - POST {public:false} deletes the same pair.
 * - Invalid ids / bodies are rejected.
 */

const mockReadOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTupleDiff = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  writeOpenFgaTupleDiff: (...args: unknown[]) => mockWriteOpenFgaTupleDiff(...args),
}));

const mockLogAudit = jest.fn();
jest.mock("@/lib/rbac/audit", () => ({
  logOpenFgaRebacAuditEvent: (...args: unknown[]) => mockLogAudit(...args),
}));

// Auth wrappers: pass through to the handler with a fake admin context.
jest.mock("../../../openfga/_lib", () => ({
  withOpenFgaViewAuth: (_req: unknown, handler: (auth: unknown) => Promise<unknown>) =>
    handler({ user: { email: "admin@example.com" }, session: { org: "caipe", sub: "admin-sub" } }),
  withOpenFgaAdminAuth: (_req: unknown, handler: (auth: unknown) => Promise<unknown>) =>
    handler({ user: { email: "admin@example.com" }, session: { org: "caipe", sub: "admin-sub" } }),
}));

import { NextRequest } from "next/server";
import { GET, POST } from "../route";

function get(datasourceId?: string): NextRequest {
  const url = new URL("http://localhost/api/admin/rag/public-datasources");
  if (datasourceId !== undefined) url.searchParams.set("datasource_id", datasourceId);
  return new NextRequest(url, { method: "GET" });
}

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/rag/public-datasources", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("/api/admin/rag/public-datasources", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });
    mockWriteOpenFgaTupleDiff.mockResolvedValue({ enabled: true, writes: 2, deletes: 0 });
  });

  describe("GET", () => {
    it("rejects an invalid datasource id", async () => {
      const res = await GET(get("..bad..!"));
      expect(res.status).toBe(400);
    });

    it("reports public=false when no wildcard tuple exists", async () => {
      const res = await GET(get("src-1"));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ data: { datasource_id: "src-1", public: false } });
    });

    it("reports public=true when the data_source wildcard reader tuple exists", async () => {
      mockReadOpenFgaTuples.mockResolvedValueOnce({
        tuples: [{ key: { user: "user:*", relation: "reader", object: "data_source:src-1" } }],
      });
      const res = await GET(get("src-1"));
      expect(await res.json()).toMatchObject({ data: { public: true } });
    });
  });

  describe("POST", () => {
    it("writes the wildcard reader tuple on both types when public=true", async () => {
      const res = await POST(post({ datasource_id: "src-1", public: true }));
      expect(res.status).toBe(200);
      expect(mockWriteOpenFgaTupleDiff).toHaveBeenCalledWith({
        writes: [
          { user: "user:*", relation: "reader", object: "knowledge_base:src-1" },
          { user: "user:*", relation: "reader", object: "data_source:src-1" },
        ],
        deletes: [],
      });
    });

    it("deletes the wildcard reader tuple on both types when public=false", async () => {
      const res = await POST(post({ datasource_id: "src-1", public: false }));
      expect(res.status).toBe(200);
      expect(mockWriteOpenFgaTupleDiff).toHaveBeenCalledWith({
        writes: [],
        deletes: [
          { user: "user:*", relation: "reader", object: "knowledge_base:src-1" },
          { user: "user:*", relation: "reader", object: "data_source:src-1" },
        ],
      });
    });

    it("rejects a non-boolean public flag", async () => {
      const res = await POST(post({ datasource_id: "src-1", public: "yes" }));
      expect(res.status).toBe(400);
    });

    it("returns 503 when OpenFGA reconciliation is disabled", async () => {
      mockWriteOpenFgaTupleDiff.mockResolvedValueOnce({ enabled: false, writes: 0, deletes: 0 });
      const res = await POST(post({ datasource_id: "src-1", public: true }));
      expect(res.status).toBe(503);
    });
  });
});
