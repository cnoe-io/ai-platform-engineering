// assisted-by claude code claude-opus-4-8

import {
  catalogEntityToYaml,
  deriveCatalogSlug,
  entityETag,
  ifMatchSatisfied,
  isCatalogKind,
  resolveHierarchy,
  toBackstageEntity,
} from "@/lib/projects/catalog-store";
import type { CatalogEntityDocument } from "@/types/catalog";

function entity(
  overrides: Partial<CatalogEntityDocument> & { kind: CatalogEntityDocument["kind"] },
): CatalogEntityDocument {
  return {
    slug: overrides.slug ?? "x",
    name: "X",
    title: "X",
    description: "",
    parent: null,
    domain: null,
    owner: null,
    type: null,
    lifecycle: null,
    tags: [],
    annotations: {},
    links: [],
    created_at: new Date(0),
    updated_at: new Date(0),
    created_by: null,
    updated_by: null,
    ...overrides,
  };
}

describe("catalog-store", () => {
  describe("deriveCatalogSlug", () => {
    it("makes a url-safe slug", () => {
      expect(deriveCatalogSlug("Platform Engineering!")).toBe("platform-engineering");
    });
  });

  describe("isCatalogKind", () => {
    it("accepts known kinds and rejects others", () => {
      expect(isCatalogKind("domain")).toBe(true);
      expect(isCatalogKind("component")).toBe(true);
      expect(isCatalogKind("group")).toBe(false);
      expect(isCatalogKind(42)).toBe(false);
    });
  });

  describe("resolveHierarchy", () => {
    it("treats a domain as a root with no parent", () => {
      expect(resolveHierarchy("domain", null, null)).toEqual({
        parent: null,
        domain: null,
      });
    });

    it("rejects a domain that declares a parent", () => {
      expect(() => resolveHierarchy("domain", "platform", null)).toThrow(
        /cannot have a parent/,
      );
    });

    it("requires a parent for non-domain kinds", () => {
      expect(() => resolveHierarchy("system", null, null)).toThrow(/requires a parent/);
    });

    it("404s when the parent slug does not resolve", () => {
      expect(() => resolveHierarchy("subdomain", "missing", null)).toThrow(/not found/);
    });

    it("rejects a wrong parent kind", () => {
      const sys = entity({ kind: "system", slug: "billing", domain: "platform" });
      expect(() => resolveHierarchy("component", "billing", sys)).not.toThrow();
      expect(() => resolveHierarchy("subdomain", "billing", sys)).toThrow(
        /must belong to a domain/,
      );
    });

    it("denormalizes the root domain for a subdomain under a domain", () => {
      const dom = entity({ kind: "domain", slug: "platform", domain: null });
      expect(resolveHierarchy("subdomain", "platform", dom)).toEqual({
        parent: "platform",
        domain: "platform",
      });
    });

    it("propagates the root domain through a subdomain to a system", () => {
      const sub = entity({ kind: "subdomain", slug: "payments", domain: "platform" });
      expect(resolveHierarchy("system", "payments", sub)).toEqual({
        parent: "payments",
        domain: "platform",
      });
    });

    it("propagates the root domain from a system to a component", () => {
      const sys = entity({ kind: "system", slug: "billing", domain: "platform" });
      expect(resolveHierarchy("component", "billing", sys)).toEqual({
        parent: "billing",
        domain: "platform",
      });
    });
  });

  describe("toBackstageEntity", () => {
    it("maps a subdomain to kind Domain with subdomainOf", () => {
      const be = toBackstageEntity(
        entity({ kind: "subdomain", slug: "payments", parent: "platform", owner: "group:pay" }),
      );
      expect(be.kind).toBe("Domain");
      expect(be.spec).toEqual({ owner: "group:pay", subdomainOf: "platform" });
    });

    it("maps a system to kind System with its domain", () => {
      const be = toBackstageEntity(
        entity({ kind: "system", slug: "billing", parent: "payments" }),
      );
      expect(be.kind).toBe("System");
      expect(be.spec).toEqual({ domain: "payments" });
    });

    it("maps a component with type, lifecycle and system", () => {
      const be = toBackstageEntity(
        entity({
          kind: "component",
          slug: "billing-api",
          parent: "billing",
          type: "service",
          lifecycle: "production",
          owner: "group:pay",
        }),
      );
      expect(be.kind).toBe("Component");
      expect(be.spec).toEqual({
        owner: "group:pay",
        type: "service",
        lifecycle: "production",
        system: "billing",
      });
    });

    it("changes the ETag when updated_at changes", () => {
      const a = entityETag({ slug: "billing", updated_at: new Date(1000) });
      const b = entityETag({ slug: "billing", updated_at: new Date(2000) });
      expect(a).not.toBe(b);
      expect(a).toBe('"billing-1000"');
    });
  });

  describe("ifMatchSatisfied", () => {
    const etag = '"billing-1000"';
    it("passes when no precondition is sent", () => {
      expect(ifMatchSatisfied(null, etag)).toBe(true);
    });
    it("passes on wildcard", () => {
      expect(ifMatchSatisfied("*", etag)).toBe(true);
    });
    it("passes on exact match (incl. comma lists)", () => {
      expect(ifMatchSatisfied(etag, etag)).toBe(true);
      expect(ifMatchSatisfied(`"x", ${etag}`, etag)).toBe(true);
    });
    it("fails on stale tag", () => {
      expect(ifMatchSatisfied('"billing-999"', etag)).toBe(false);
    });
  });

  describe("yaml", () => {
    it("renders valid YAML", () => {
      const yaml = catalogEntityToYaml(
        entity({ kind: "domain", slug: "platform", title: "Platform" }),
      );
      expect(yaml).toContain("apiVersion: backstage.io/v1alpha1");
      expect(yaml).toContain("kind: Domain");
      expect(yaml).toContain("name: platform");
    });
  });
});
