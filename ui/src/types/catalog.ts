// assisted-by claude code claude-opus-4-8
//
// Backstage-style software catalog entities backed by a single MongoDB
// collection (`catalog`). Every document is discriminated by `kind` and
// linked to its parent by slug, encoding the hierarchy:
//
//   domain → subdomain → system (project) → component
//
// This is intentionally a thin API surface over MongoDB — it does not talk to
// a real Backstage instance. `toBackstageEntity` (see catalog-store.ts) renders
// a document into the `backstage.io/v1alpha1` shape for export.

/** The four catalog levels we model. `system` is a Backstage System (a project). */
export type CatalogKind = "domain" | "subdomain" | "system" | "component";

export const CATALOG_KINDS: readonly CatalogKind[] = [
  "domain",
  "subdomain",
  "system",
  "component",
] as const;

/**
 * Which parent kinds are valid for a given kind. A `domain` is a root (no
 * parent); everything else must point at a parent of one of these kinds.
 */
export const PARENT_KINDS: Record<CatalogKind, CatalogKind[]> = {
  domain: [],
  subdomain: ["domain"],
  system: ["domain", "subdomain"],
  component: ["system"],
};

export interface CatalogLink {
  url: string;
  title?: string;
}

/** A single catalog entity as stored in MongoDB. */
export interface CatalogEntityDocument {
  _id?: string;
  kind: CatalogKind;
  /** URL-safe unique identifier across the whole catalog. Derived from name. */
  slug: string;
  name: string;
  title: string;
  description: string;
  /** Slug of the immediate parent entity. `null` for domains. */
  parent: string | null;
  /** Slug of the root domain in this entity's chain (denormalized for filtering). */
  domain: string | null;
  /** Backstage `spec.owner`, e.g. `group:platform` or `user:alice@example.com`. */
  owner: string | null;
  /** Backstage `spec.type` for systems/components (service, website, library, …). */
  type: string | null;
  /** Backstage `spec.lifecycle` for components (experimental|production|deprecated). */
  lifecycle: string | null;
  tags: string[];
  annotations: Record<string, string>;
  links: CatalogLink[];
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

export interface CreateCatalogEntityRequest {
  kind: CatalogKind;
  name: string;
  title?: string;
  description?: string;
  /** Slug of the parent entity. Required for every kind except `domain`. */
  parent?: string | null;
  owner?: string;
  type?: string;
  lifecycle?: string;
  tags?: string[];
  annotations?: Record<string, string>;
  links?: CatalogLink[];
}

/** Partial update. `kind` and `slug` are immutable. */
export type UpdateCatalogEntityRequest = Partial<
  Omit<CreateCatalogEntityRequest, "kind">
>;

/** Backstage `catalog-info.yaml` entity shape (v1alpha1). */
export interface BackstageCatalogEntity {
  apiVersion: "backstage.io/v1alpha1";
  kind: "Domain" | "System" | "Component";
  metadata: {
    name: string;
    title: string;
    description: string;
    tags: string[];
    annotations: Record<string, string>;
    links?: CatalogLink[];
  };
  spec: Record<string, unknown>;
}
