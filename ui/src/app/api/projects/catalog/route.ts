// assisted-by claude code claude-opus-4-8
//
// Catalog collection endpoint.
//   GET  /api/projects/catalog            — list entities (filterable)
//   POST /api/projects/catalog            — create an entity
//
// Reads require authentication; writes require org-admin (same model as the
// projects routes). Backed by the single `catalog` MongoDB collection.

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  CATALOG_COLLECTION,
  deriveCatalogSlug,
  entityETag,
  isCatalogKind,
  resolveHierarchy,
  serializeCatalogEntity,
} from "@/lib/projects/catalog-store";
import { requireProjectsOrgAdmin } from "@/lib/projects/project-admin";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type {
  CatalogEntityDocument,
  CreateCatalogEntityRequest,
} from "@/types/catalog";

function catalogCollection() {
  return getCollection<CatalogEntityDocument>(CATALOG_COLLECTION);
}

function requireMongo(): void {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  requireMongo();
  await getAuthFromBearerOrSession(request);

  const { searchParams } = new URL(request.url);
  const filter: Record<string, unknown> = {};

  const kind = searchParams.get("kind");
  if (kind) {
    if (!isCatalogKind(kind)) {
      throw new ApiError(`Unknown kind "${kind}"`, 400, "CATALOG_INVALID_KIND");
    }
    filter.kind = kind;
  }

  const parent = searchParams.get("parent");
  if (parent) filter.parent = parent;

  const domain = searchParams.get("domain");
  if (domain) filter.domain = domain;

  const owner = searchParams.get("owner");
  if (owner) filter.owner = owner;

  const q = searchParams.get("q")?.trim();
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ name: rx }, { title: rx }, { slug: rx }, { description: rx }];
  }

  // Sorting: ?sort=<field>&order=asc|desc (default kind asc, then name asc).
  const SORTABLE = new Set(["kind", "name", "slug", "created_at", "updated_at"]);
  const sortField = searchParams.get("sort");
  const order = searchParams.get("order") === "desc" ? -1 : 1;
  const sort: Record<string, 1 | -1> =
    sortField && SORTABLE.has(sortField)
      ? { [sortField]: order as 1 | -1 }
      : { kind: 1, name: 1 };

  // Pagination is opt-in: without ?limit the full set is returned (the tree
  // UI needs every node). `total`/`has_more` are always reported.
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(1000, Number(limitParam) || 0)) : 0;
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  const collection = await catalogCollection();
  const total = await collection.countDocuments(filter);

  let cursor = collection.find(filter).sort(sort);
  if (limit > 0) cursor = cursor.skip(offset).limit(limit);
  const entities = await cursor.toArray();

  return successResponse({
    entities: entities.map(serializeCatalogEntity),
    total,
    limit: limit || total,
    offset,
    has_more: limit > 0 ? offset + entities.length < total : false,
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  requireMongo();
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireProjectsOrgAdmin(session);

  const body = (await request.json()) as CreateCatalogEntityRequest;

  if (!isCatalogKind(body.kind)) {
    throw new ApiError("A valid kind is required", 400, "CATALOG_INVALID_KIND");
  }
  if (!body.name?.trim()) {
    throw new ApiError("Name is required", 400, "VALIDATION_ERROR");
  }

  const slug = deriveCatalogSlug(body.name);
  if (!slug) {
    throw new ApiError("Could not derive a slug from name", 400, "VALIDATION_ERROR");
  }

  const collection = await catalogCollection();

  const existing = await collection.findOne({ slug });
  if (existing) {
    throw new ApiError(
      `Catalog entity "${slug}" already exists`,
      409,
      "CATALOG_ENTITY_EXISTS",
    );
  }

  const parentSlug = body.parent?.trim() || null;
  const parentDoc = parentSlug
    ? await collection.findOne({ slug: parentSlug })
    : null;
  const { parent, domain } = resolveHierarchy(body.kind, parentSlug, parentDoc);

  const now = new Date();
  const doc: CatalogEntityDocument = {
    kind: body.kind,
    slug,
    name: body.name.trim(),
    title: body.title?.trim() || body.name.trim(),
    description: body.description?.trim() || "",
    parent,
    domain,
    owner: body.owner?.trim() || null,
    type: body.type?.trim() || null,
    lifecycle: body.lifecycle?.trim() || null,
    tags: body.tags?.map((t) => t.trim()).filter(Boolean) ?? [],
    annotations: body.annotations ?? {},
    links: body.links ?? [],
    created_at: now,
    updated_at: now,
    created_by: user.email ?? null,
    updated_by: user.email ?? null,
  };

  const result = await collection.insertOne(
    doc as CatalogEntityDocument & { _id?: ObjectId },
  );

  const created = { ...doc, _id: String(result.insertedId) };
  const res = successResponse({ entity: created }, 201);
  res.headers.set("Location", `/api/projects/catalog/${slug}`);
  res.headers.set("ETag", entityETag(created));
  return res;
});
