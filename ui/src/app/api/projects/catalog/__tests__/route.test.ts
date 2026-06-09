/**
 * @jest-environment node
 */
// assisted-by claude code claude-opus-4-8
//
// Route-level tests for the catalog API. MongoDB and auth are mocked; the real
// catalog-store logic and the real ApiError class run unmocked so error codes
// and ETag/hierarchy behavior are exercised end to end.

import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";

import { entityETag } from "@/lib/projects/catalog-store";
import type { CatalogEntityDocument } from "@/types/catalog";

const mockGetAuth = jest.fn();
const mockRequireOrgAdmin = jest.fn();
const mockCollections: Record<string, ReturnType<typeof createMockCollection>> = {};

jest.mock("@/lib/api-middleware", () => {
  const { ApiError } = jest.requireActual("@/lib/api-error");
  return {
    ApiError,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuth(...args),
    successResponse: (data: unknown, status = 200) =>
      NextResponse.json({ success: true, data }, { status }),
    withErrorHandler:
      (handler: (...args: any[]) => Promise<Response>) =>
      async (...args: any[]) => {
        try {
          return await handler(...args);
        } catch (error: any) {
          return NextResponse.json(
            { success: false, error: error?.message ?? "error", code: error?.code },
            { status: typeof error?.statusCode === "number" ? error.statusCode : 500 },
          );
        }
      },
  };
});

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async (name: string) => mockCollections[name] ?? createMockCollection([])),
}));

jest.mock("@/lib/projects/project-admin", () => ({
  requireProjectsOrgAdmin: (...args: unknown[]) => mockRequireOrgAdmin(...args),
  canManageProjectsOrganization: jest.fn(async () => true),
}));

// ---- minimal in-memory MongoDB collection -------------------------------

function matchesFilter(row: any, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or" && Array.isArray(value)) {
      return value.some((clause) => matchesFilter(row, clause));
    }
    if (value instanceof ObjectId) return String(row[key]) === String(value);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if ("$ne" in value) return row[key] !== value.$ne;
      if ("$in" in value) return value.$in.includes(row[key]);
      if ("$regex" in value) {
        return new RegExp(value.$regex, value.$options ?? "").test(String(row[key] ?? ""));
      }
    }
    return row[key] === value;
  });
}

function comparator(spec: Record<string, 1 | -1>) {
  const keys = Object.entries(spec);
  return (a: any, b: any) => {
    for (const [k, dir] of keys) {
      if (a[k] < b[k]) return -1 * dir;
      if (a[k] > b[k]) return 1 * dir;
    }
    return 0;
  };
}

function makeCursor(initial: any[]) {
  let arr = [...initial];
  const cursor = {
    sort(spec: Record<string, 1 | -1>) {
      arr.sort(comparator(spec));
      return cursor;
    },
    skip(n: number) {
      arr = arr.slice(n);
      return cursor;
    },
    limit(n: number) {
      arr = arr.slice(0, n);
      return cursor;
    },
    project() {
      return cursor;
    },
    toArray: async () => arr.map((d) => ({ ...d })),
  };
  return cursor;
}

function createMockCollection(rows: any[]) {
  const docs = rows.map((r) => ({ ...r }));
  return {
    docs,
    find: (filter: Record<string, any> = {}) =>
      makeCursor(docs.filter((r) => matchesFilter(r, filter))),
    findOne: async (filter: Record<string, any>) =>
      docs.find((r) => matchesFilter(r, filter)) ?? null,
    countDocuments: async (filter: Record<string, any> = {}) =>
      docs.filter((r) => matchesFilter(r, filter)).length,
    insertOne: async (doc: any) => {
      const _id = new ObjectId();
      docs.push({ ...doc, _id });
      return { insertedId: _id };
    },
    updateOne: async (filter: Record<string, any>, update: any) => {
      const row = docs.find((r) => matchesFilter(r, filter));
      if (row && update.$set) Object.assign(row, update.$set);
      return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
    },
    updateMany: async (filter: Record<string, any>, update: any) => {
      const matched = docs.filter((r) => matchesFilter(r, filter));
      matched.forEach((r) => Object.assign(r, update.$set));
      return { matchedCount: matched.length, modifiedCount: matched.length };
    },
    deleteMany: async (filter: Record<string, any>) => {
      let deleted = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matchesFilter(docs[i], filter)) {
          docs.splice(i, 1);
          deleted++;
        }
      }
      return { deletedCount: deleted };
    },
  };
}

// ---- fixtures ------------------------------------------------------------

function ent(over: Partial<CatalogEntityDocument> & Pick<CatalogEntityDocument, "kind" | "slug">) {
  return {
    name: over.slug,
    title: over.slug,
    description: "",
    parent: null,
    domain: null,
    owner: null,
    type: null,
    lifecycle: null,
    tags: [],
    annotations: {},
    links: [],
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    created_by: null,
    updated_by: null,
    _id: new ObjectId(),
    ...over,
  } as CatalogEntityDocument;
}

function seed() {
  mockCollections.catalog = createMockCollection([
    ent({ kind: "domain", slug: "platform", name: "Platform" }),
    ent({ kind: "domain", slug: "data", name: "Data" }),
    ent({ kind: "subdomain", slug: "payments", name: "Payments", parent: "platform", domain: "platform" }),
    ent({ kind: "system", slug: "billing", name: "Billing", parent: "payments", domain: "platform", owner: "group:pay" }),
    ent({
      kind: "component",
      slug: "billing-api",
      name: "Billing API",
      parent: "billing",
      domain: "platform",
      type: "service",
      lifecycle: "production",
    }),
  ]);
}

function req(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
  mockGetAuth.mockResolvedValue({
    user: { email: "admin@example.com" },
    session: { user: { email: "admin@example.com" } },
  });
  mockRequireOrgAdmin.mockResolvedValue(undefined);
  seed();
});

// ---- GET list ------------------------------------------------------------

describe("GET /api/projects/catalog", () => {
  it("returns the full tree with pagination metadata when no limit is given", async () => {
    const { GET } = await import("../route");
    const res = await GET(req("/api/projects/catalog"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.entities).toHaveLength(5);
    expect(body.data.total).toBe(5);
    expect(body.data.has_more).toBe(false);
  });

  it("filters by kind", async () => {
    const { GET } = await import("../route");
    const res = await GET(req("/api/projects/catalog?kind=domain"));
    const body = await res.json();
    expect(body.data.entities.map((e: any) => e.slug).sort()).toEqual(["data", "platform"]);
  });

  it("filters by parent and by domain", async () => {
    const { GET } = await import("../route");
    const byParent = await (await GET(req("/api/projects/catalog?parent=billing"))).json();
    expect(byParent.data.entities.map((e: any) => e.slug)).toEqual(["billing-api"]);

    const byDomain = await (await GET(req("/api/projects/catalog?domain=platform"))).json();
    expect(byDomain.data.entities).toHaveLength(3); // payments, billing, billing-api
  });

  it("supports q search across name/slug/description", async () => {
    const { GET } = await import("../route");
    const res = await GET(req("/api/projects/catalog?q=bill"));
    const body = await res.json();
    expect(body.data.entities.map((e: any) => e.slug).sort()).toEqual(["billing", "billing-api"]);
  });

  it("paginates with limit/offset and reports has_more", async () => {
    const { GET } = await import("../route");
    const res = await GET(req("/api/projects/catalog?sort=slug&limit=2&offset=0"));
    const body = await res.json();
    expect(body.data.entities).toHaveLength(2);
    expect(body.data.total).toBe(5);
    expect(body.data.has_more).toBe(true);
    expect(body.data.entities[0].slug).toBe("billing"); // slug asc
  });

  it("rejects an unknown kind with 400", async () => {
    const { GET } = await import("../route");
    const res = await GET(req("/api/projects/catalog?kind=group"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("CATALOG_INVALID_KIND");
  });
});

// ---- POST create ---------------------------------------------------------

describe("POST /api/projects/catalog", () => {
  it("creates a domain with 201, Location and ETag headers", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      req("/api/projects/catalog", {
        method: "POST",
        body: JSON.stringify({ kind: "domain", name: "Growth" }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.entity.slug).toBe("growth");
    expect(body.data.entity.parent).toBeNull();
    expect(res.headers.get("Location")).toBe("/api/projects/catalog/growth");
    expect(res.headers.get("ETag")).toBeTruthy();
  });

  it("denormalizes the root domain down the hierarchy", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      req("/api/projects/catalog", {
        method: "POST",
        body: JSON.stringify({ kind: "system", name: "Ledger", parent: "payments" }),
      }),
    );
    const body = await res.json();
    expect(body.data.entity.domain).toBe("platform");
    expect(body.data.entity.parent).toBe("payments");
  });

  it("rejects a duplicate slug with 409", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      req("/api/projects/catalog", {
        method: "POST",
        body: JSON.stringify({ kind: "domain", name: "Platform" }),
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("CATALOG_ENTITY_EXISTS");
  });

  it("rejects a wrong parent kind with 400", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      req("/api/projects/catalog", {
        method: "POST",
        body: JSON.stringify({ kind: "component", name: "Orphan", parent: "platform" }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("CATALOG_INVALID_PARENT");
  });

  it("rejects a missing name with 400", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      req("/api/projects/catalog", {
        method: "POST",
        body: JSON.stringify({ kind: "domain", name: "  " }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 for a non-admin", async () => {
    const { ApiError } = jest.requireActual("@/lib/api-error");
    mockRequireOrgAdmin.mockRejectedValueOnce(new ApiError("forbidden", 403, "FORBIDDEN"));
    const { POST } = await import("../route");
    const res = await POST(
      req("/api/projects/catalog", {
        method: "POST",
        body: JSON.stringify({ kind: "domain", name: "Nope" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

// ---- GET one -------------------------------------------------------------

describe("GET /api/projects/catalog/[id]", () => {
  it("returns the entity, YAML and an ETag", async () => {
    const { GET } = await import("../[id]/route");
    const res = await GET(req("/api/projects/catalog/billing"), ctx("billing"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.entity.slug).toBe("billing");
    expect(body.data.catalog_yaml).toContain("kind: System");
    expect(res.headers.get("ETag")).toBe(
      entityETag({ slug: "billing", updated_at: new Date("2026-01-01T00:00:00Z") }),
    );
  });

  it("404s for an unknown slug", async () => {
    const { GET } = await import("../[id]/route");
    const res = await GET(req("/api/projects/catalog/ghost"), ctx("ghost"));
    expect(res.status).toBe(404);
  });
});

// ---- PUT replace ---------------------------------------------------------

describe("PUT /api/projects/catalog/[id]", () => {
  it("replaces fields and resets omitted ones to defaults", async () => {
    const { PUT } = await import("../[id]/route");
    // billing currently has owner group:pay; PUT without owner should clear it.
    const res = await PUT(
      req("/api/projects/catalog/billing", {
        method: "PUT",
        body: JSON.stringify({ title: "Billing v2", parent: "payments" }),
      }),
      ctx("billing"),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.entity.title).toBe("Billing v2");
    expect(body.data.entity.owner).toBeNull(); // reset by full replace
  });

  it("cascades the root domain to descendants when re-parented", async () => {
    // Move subdomain 'payments' from domain 'platform' to domain 'data'.
    const { PUT } = await import("../[id]/route");
    const res = await PUT(
      req("/api/projects/catalog/payments", {
        method: "PUT",
        body: JSON.stringify({ parent: "data" }),
      }),
      ctx("payments"),
    );
    expect(res.status).toBe(200);
    const docs = mockCollections.catalog.docs;
    expect(docs.find((d) => d.slug === "payments")!.domain).toBe("data");
    expect(docs.find((d) => d.slug === "billing")!.domain).toBe("data");
    expect(docs.find((d) => d.slug === "billing-api")!.domain).toBe("data");
  });

  it("rejects a stale If-Match with 412", async () => {
    const { PUT } = await import("../[id]/route");
    const res = await PUT(
      req("/api/projects/catalog/billing", {
        method: "PUT",
        headers: { "If-Match": '"billing-000"' },
        body: JSON.stringify({ title: "X", parent: "payments" }),
      }),
      ctx("billing"),
    );
    expect(res.status).toBe(412);
    expect((await res.json()).code).toBe("PRECONDITION_FAILED");
  });

  it("accepts a matching If-Match", async () => {
    const tag = entityETag({ slug: "billing", updated_at: new Date("2026-01-01T00:00:00Z") });
    const { PUT } = await import("../[id]/route");
    const res = await PUT(
      req("/api/projects/catalog/billing", {
        method: "PUT",
        headers: { "If-Match": tag },
        body: JSON.stringify({ title: "Billing", parent: "payments" }),
      }),
      ctx("billing"),
    );
    expect(res.status).toBe(200);
  });
});

// ---- PATCH merge ---------------------------------------------------------

describe("PATCH /api/projects/catalog/[id]", () => {
  it("only updates provided fields and leaves the rest intact", async () => {
    const { PATCH } = await import("../[id]/route");
    const res = await PATCH(
      req("/api/projects/catalog/billing", {
        method: "PATCH",
        body: JSON.stringify({ description: "Now with notes" }),
      }),
      ctx("billing"),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.entity.description).toBe("Now with notes");
    expect(body.data.entity.owner).toBe("group:pay"); // untouched by merge
    expect(body.data.entity.parent).toBe("payments"); // untouched by merge
  });
});

// ---- DELETE --------------------------------------------------------------

describe("DELETE /api/projects/catalog/[id]", () => {
  it("deletes a leaf with 204", async () => {
    const { DELETE } = await import("../[id]/route");
    const res = await DELETE(req("/api/projects/catalog/billing-api", { method: "DELETE" }), ctx("billing-api"));
    expect(res.status).toBe(204);
    expect(mockCollections.catalog.docs.find((d) => d.slug === "billing-api")).toBeUndefined();
  });

  it("refuses to delete a node with children (409) unless cascade", async () => {
    const { DELETE } = await import("../[id]/route");
    const blocked = await DELETE(req("/api/projects/catalog/platform", { method: "DELETE" }), ctx("platform"));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).code).toBe("CATALOG_HAS_CHILDREN");
    expect(mockCollections.catalog.docs).toHaveLength(5); // nothing removed
  });

  it("cascade=true removes the whole subtree with 204", async () => {
    const { DELETE } = await import("../[id]/route");
    const res = await DELETE(
      req("/api/projects/catalog/platform?cascade=true", { method: "DELETE" }),
      ctx("platform"),
    );
    expect(res.status).toBe(204);
    const slugs = mockCollections.catalog.docs.map((d) => d.slug).sort();
    expect(slugs).toEqual(["data"]); // platform + payments + billing + billing-api gone
  });

  it("rejects a stale If-Match with 412", async () => {
    const { DELETE } = await import("../[id]/route");
    const res = await DELETE(
      req("/api/projects/catalog/billing-api", {
        method: "DELETE",
        headers: { "If-Match": '"stale"' },
      }),
      ctx("billing-api"),
    );
    expect(res.status).toBe(412);
  });

  it("returns 403 for a non-admin", async () => {
    const { ApiError } = jest.requireActual("@/lib/api-error");
    mockRequireOrgAdmin.mockRejectedValueOnce(new ApiError("forbidden", 403, "FORBIDDEN"));
    const { DELETE } = await import("../[id]/route");
    const res = await DELETE(req("/api/projects/catalog/billing-api", { method: "DELETE" }), ctx("billing-api"));
    expect(res.status).toBe(403);
  });
});
