// assisted-by claude code claude-opus-4-8
//
// Single catalog entity endpoint, addressable by Mongo _id or slug.
//   GET    /api/projects/catalog/:id   — fetch one (+ Backstage YAML); sends ETag
//   PUT    /api/projects/catalog/:id   — full replace of mutable fields
//   PATCH  /api/projects/catalog/:id   — partial merge of provided fields
//   DELETE /api/projects/catalog/:id   — delete → 204 (409 if it has children
//                                        unless ?cascade=true)
//
// `kind` and `slug` are immutable. Re-parenting recomputes the denormalized
// root `domain` for the entity and every descendant. Writes honor `If-Match`
// for optimistic concurrency (412 Precondition Failed on a stale ETag).

import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Collection } from "mongodb";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  CATALOG_COLLECTION,
  catalogEntityToYaml,
  entityETag,
  ifMatchSatisfied,
  resolveHierarchy,
  serializeCatalogEntity,
} from "@/lib/projects/catalog-store";
import { requireProjectsOrgAdmin } from "@/lib/projects/project-admin";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type {
  CatalogEntityDocument,
  UpdateCatalogEntityRequest,
} from "@/types/catalog";

function catalogCollection() {
  return getCollection<CatalogEntityDocument>(CATALOG_COLLECTION);
}

function requireMongo(): void {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }
}

async function findEntity(
  collection: Collection<CatalogEntityDocument>,
  id: string,
): Promise<CatalogEntityDocument> {
  let doc: CatalogEntityDocument | null = null;
  if (ObjectId.isValid(id)) {
    doc = await collection.findOne({ _id: new ObjectId(id) } as Record<string, unknown>);
  }
  if (!doc) {
    doc = await collection.findOne({ slug: id });
  }
  if (!doc) {
    throw new ApiError("Catalog entity not found", 404, "CATALOG_NOT_FOUND");
  }
  return doc;
}

/** Reject the write when the client's `If-Match` does not match the live ETag. */
function assertPrecondition(
  request: NextRequest,
  existing: CatalogEntityDocument,
): void {
  if (!ifMatchSatisfied(request.headers.get("if-match"), entityETag(existing))) {
    throw new ApiError(
      "If-Match precondition failed — the entity changed since you last read it",
      412,
      "PRECONDITION_FAILED",
    );
  }
}

/** Collect the slugs of every descendant of `rootSlug` via parent links (BFS). */
async function descendantSlugs(
  collection: Collection<CatalogEntityDocument>,
  rootSlug: string,
): Promise<string[]> {
  const out: string[] = [];
  let frontier = [rootSlug];
  while (frontier.length) {
    const children = await collection
      .find({ parent: { $in: frontier } })
      .project({ slug: 1 })
      .toArray();
    const slugs = children.map((c) => String(c.slug));
    if (!slugs.length) break;
    out.push(...slugs);
    frontier = slugs;
  }
  return out;
}

/**
 * Build the `$set` for the mutable scalar fields.
 *   - replace (PUT): every field is written; omitted fields reset to defaults.
 *   - merge (PATCH): only fields present in the body are written.
 */
function buildScalarSet(
  existing: CatalogEntityDocument,
  body: UpdateCatalogEntityRequest,
  replace: boolean,
): Partial<CatalogEntityDocument> {
  const set: Partial<CatalogEntityDocument> = {};

  if (body.title !== undefined) set.title = body.title.trim() || existing.name;
  else if (replace) set.title = existing.name;

  if (body.description !== undefined) set.description = body.description.trim();
  else if (replace) set.description = "";

  if (body.owner !== undefined) set.owner = body.owner.trim() || null;
  else if (replace) set.owner = null;

  if (body.type !== undefined) set.type = body.type.trim() || null;
  else if (replace) set.type = null;

  if (body.lifecycle !== undefined) set.lifecycle = body.lifecycle.trim() || null;
  else if (replace) set.lifecycle = null;

  if (body.tags !== undefined) set.tags = body.tags.map((t) => t.trim()).filter(Boolean);
  else if (replace) set.tags = [];

  if (body.annotations !== undefined) set.annotations = body.annotations;
  else if (replace) set.annotations = {};

  if (body.links !== undefined) set.links = body.links;
  else if (replace) set.links = [];

  return set;
}

/** Shared update path for PUT (replace) and PATCH (merge). */
async function mutateEntity(
  request: NextRequest,
  id: string,
  replace: boolean,
): Promise<NextResponse> {
  requireMongo();
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireProjectsOrgAdmin(session);

  const collection = await catalogCollection();
  const existing = await findEntity(collection, id);
  assertPrecondition(request, existing);

  const body = (await request.json()) as UpdateCatalogEntityRequest;

  const update: Partial<CatalogEntityDocument> = {
    ...buildScalarSet(existing, body, replace),
    updated_at: new Date(),
    updated_by: user.email ?? null,
  };

  // Parent is part of the full state on PUT; on PATCH only when supplied.
  let domainChanged = false;
  let newDomain = existing.domain;
  if (replace || body.parent !== undefined) {
    const parentSlug = body.parent?.trim() || null;
    if (parentSlug === existing.slug) {
      throw new ApiError("An entity cannot be its own parent", 400, "CATALOG_INVALID_PARENT");
    }
    const parentDoc = parentSlug
      ? await collection.findOne({ slug: parentSlug })
      : null;
    const resolved = resolveHierarchy(existing.kind, parentSlug, parentDoc);
    update.parent = resolved.parent;
    update.domain = resolved.domain;
    if (resolved.domain !== existing.domain) {
      domainChanged = true;
      newDomain = resolved.domain;
    }
  }

  await collection.updateOne({ _id: existing._id } as Record<string, unknown>, {
    $set: update,
  });

  // Every descendant shares this entity's root domain — cascade if it moved.
  if (domainChanged) {
    const slugs = await descendantSlugs(collection, existing.slug);
    if (slugs.length) {
      await collection.updateMany(
        { slug: { $in: slugs } },
        { $set: { domain: newDomain, updated_at: new Date() } },
      );
    }
  }

  const fresh = await collection.findOne({ _id: existing._id } as Record<string, unknown>);
  const res = successResponse({ entity: serializeCatalogEntity(fresh!) });
  res.headers.set("ETag", entityETag(fresh!));
  return res;
}

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    requireMongo();
    await getAuthFromBearerOrSession(request);
    const { id } = await context.params;

    const collection = await catalogCollection();
    const doc = await findEntity(collection, id);

    const res = successResponse({
      entity: serializeCatalogEntity(doc),
      catalog_yaml: catalogEntityToYaml(doc),
    });
    res.headers.set("ETag", entityETag(doc));
    return res;
  },
);

export const PUT = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    return mutateEntity(request, id, true);
  },
);

export const PATCH = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    return mutateEntity(request, id, false);
  },
);

export const DELETE = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    requireMongo();
    const { session } = await getAuthFromBearerOrSession(request);
    await requireProjectsOrgAdmin(session);
    const { id } = await context.params;

    const collection = await catalogCollection();
    const existing = await findEntity(collection, id);
    assertPrecondition(request, existing);

    const cascade = new URL(request.url).searchParams.get("cascade") === "true";
    const slugs = await descendantSlugs(collection, existing.slug);

    if (slugs.length && !cascade) {
      throw new ApiError(
        `"${existing.slug}" has ${slugs.length} descendant(s); pass ?cascade=true to delete them too`,
        409,
        "CATALOG_HAS_CHILDREN",
      );
    }

    await collection.deleteMany({ slug: { $in: [existing.slug, ...slugs] } });

    // 204 No Content — successful delete carries no body.
    return new NextResponse(null, { status: 204 });
  },
);
