// assisted-by claude code claude-opus-4-8
//
// Helpers for the Backstage-style catalog stored in the single `catalog`
// MongoDB collection. Pure functions (slug/validation/export) are unit tested;
// the collection accessors wrap lib/mongodb.

import yaml from "js-yaml";

import { ApiError } from "@/lib/api-error";
import { deriveProjectSlug } from "@/lib/projects/backstage-catalog";
import {
  CATALOG_KINDS,
  PARENT_KINDS,
  type BackstageCatalogEntity,
  type CatalogEntityDocument,
  type CatalogKind,
} from "@/types/catalog";

export const CATALOG_COLLECTION = "catalog";

/** URL-safe slug; reuses the same derivation as projects for consistency. */
export function deriveCatalogSlug(name: string): string {
  return deriveProjectSlug(name);
}

export function isCatalogKind(value: unknown): value is CatalogKind {
  return (
    typeof value === "string" &&
    (CATALOG_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Validate a parent for the given kind against the entity that the parent slug
 * resolves to. Returns the resolved root-domain slug to denormalize onto the
 * child (`null` for a domain).
 *
 * Throws ApiError(400) for structural problems and ApiError(404) when the
 * referenced parent does not exist.
 */
export function resolveHierarchy(
  kind: CatalogKind,
  parentSlug: string | null | undefined,
  parent: CatalogEntityDocument | null,
): { parent: string | null; domain: string | null } {
  const allowed = PARENT_KINDS[kind];

  // Domains are roots — they must not declare a parent.
  if (allowed.length === 0) {
    if (parentSlug) {
      throw new ApiError(
        `A ${kind} cannot have a parent`,
        400,
        "CATALOG_INVALID_PARENT",
      );
    }
    return { parent: null, domain: null };
  }

  if (!parentSlug) {
    throw new ApiError(
      `A ${kind} requires a parent (${allowed.join(" or ")})`,
      400,
      "CATALOG_PARENT_REQUIRED",
    );
  }

  if (!parent) {
    throw new ApiError(
      `Parent "${parentSlug}" not found`,
      404,
      "CATALOG_PARENT_NOT_FOUND",
    );
  }

  if (!allowed.includes(parent.kind)) {
    throw new ApiError(
      `A ${kind} must belong to a ${allowed.join(" or ")}, not a ${parent.kind}`,
      400,
      "CATALOG_INVALID_PARENT",
    );
  }

  // Root domain slug: a (sub)domain parent contributes its own domain chain,
  // a domain parent is itself the root.
  const domain =
    parent.kind === "domain" ? parent.slug : parent.domain ?? parent.slug;

  return { parent: parent.slug, domain };
}

const BACKSTAGE_KIND: Record<CatalogKind, BackstageCatalogEntity["kind"]> = {
  domain: "Domain",
  subdomain: "Domain",
  system: "System",
  component: "Component",
};

/** Render a stored document into the Backstage v1alpha1 entity shape. */
export function toBackstageEntity(
  doc: CatalogEntityDocument,
): BackstageCatalogEntity {
  const spec: Record<string, unknown> = {};
  if (doc.owner) spec.owner = doc.owner;

  switch (doc.kind) {
    case "subdomain":
      if (doc.parent) spec.subdomainOf = doc.parent;
      break;
    case "system":
      if (doc.parent) spec.domain = doc.parent;
      break;
    case "component":
      if (doc.type) spec.type = doc.type;
      if (doc.lifecycle) spec.lifecycle = doc.lifecycle;
      if (doc.parent) spec.system = doc.parent;
      break;
    case "domain":
    default:
      break;
  }

  return {
    apiVersion: "backstage.io/v1alpha1",
    kind: BACKSTAGE_KIND[doc.kind],
    metadata: {
      name: doc.slug,
      title: doc.title,
      description: doc.description,
      tags: doc.tags,
      annotations: doc.annotations,
      ...(doc.links.length ? { links: doc.links } : {}),
    },
    spec,
  };
}

export function catalogEntityToYaml(doc: CatalogEntityDocument): string {
  return yaml
    .dump(toBackstageEntity(doc), { lineWidth: 100, noRefs: true })
    .trim();
}

/** Strip Mongo's ObjectId into a string `_id` for JSON responses. */
export function serializeCatalogEntity(
  doc: CatalogEntityDocument,
): CatalogEntityDocument {
  return { ...doc, _id: String(doc._id) };
}

/**
 * Strong ETag for optimistic concurrency. Changes on every write because
 * `updated_at` is bumped on each mutation. Used with `If-Match` to reject
 * lost-update races with `412 Precondition Failed`.
 */
export function entityETag(
  doc: Pick<CatalogEntityDocument, "slug" | "updated_at">,
): string {
  const ts =
    doc.updated_at instanceof Date
      ? doc.updated_at.getTime()
      : new Date(doc.updated_at).getTime();
  return `"${doc.slug}-${ts}"`;
}

/**
 * True when the client's `If-Match` value satisfies the current ETag.
 * `*` matches any existing entity; a missing header means "no precondition".
 */
export function ifMatchSatisfied(
  ifMatch: string | null,
  currentETag: string,
): boolean {
  if (!ifMatch) return true;
  const trimmed = ifMatch.trim();
  if (trimmed === "*") return true;
  return trimmed
    .split(",")
    .map((t) => t.trim())
    .includes(currentETag);
}
