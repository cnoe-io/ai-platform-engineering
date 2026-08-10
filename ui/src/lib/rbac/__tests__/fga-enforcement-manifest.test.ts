/**
 * FGA enforcement-manifest guard (spec 2026-06-04-fga-coverage-guarantee, Layer 2).
 *
 * Asserts that every registered resource type is classified, that the
 * classification is honest (surfaces exist on disk), and that `not_gated` is only
 * used for explicitly allowlisted types. A new type added to the registry fails
 * this guard until it is given an enforcement classification + surface.
 *
 * assisted-by Cursor claude-opus-4.8
 */

import { existsSync } from "fs";
import { join } from "path";

import { UNIVERSAL_REBAC_RESOURCE_TYPES } from "../resource-model";
import {
  FGA_ENFORCEMENT_MANIFEST,
  NOT_GATED_ALLOWLIST,
} from "../fga-enforcement-manifest";
import type { UniversalRebacResourceType } from "@/types/rbac-universal";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");

const VALID_STATUSES = new Set([
  "not_gated",
  "role_gated",
  "rebac_shadowed",
  "rebac_enforced",
  "deprecated",
]);

const registryTypes = UNIVERSAL_REBAC_RESOURCE_TYPES.map((d) => d.type);

describe("fga enforcement manifest", () => {
  it("classifies every registered resource type (no gaps)", () => {
    const manifestTypes = Object.keys(FGA_ENFORCEMENT_MANIFEST).sort();
    expect(manifestTypes).toEqual([...registryTypes].sort());
  });

  it("has no manifest entries for unregistered types (no orphans)", () => {
    const registrySet = new Set<string>(registryTypes);
    for (const t of Object.keys(FGA_ENFORCEMENT_MANIFEST)) {
      expect(registrySet.has(t)).toBe(true);
    }
  });

  describe.each(registryTypes)("type %s", (type) => {
    const entry = FGA_ENFORCEMENT_MANIFEST[type as UniversalRebacResourceType];

    it("has a valid enforcement status", () => {
      expect(VALID_STATUSES.has(entry.status)).toBe(true);
    });

    it("documents at least one surface and a note", () => {
      expect(entry.surfaces.length).toBeGreaterThan(0);
      expect(entry.notes.trim().length).toBeGreaterThan(0);
    });

    it("points every surface at a file that exists on disk", () => {
      for (const surface of entry.surfaces) {
        expect(existsSync(join(REPO_ROOT, surface))).toBe(true);
      }
    });

    it("only uses not_gated when explicitly allowlisted with a reason", () => {
      if (entry.status === "not_gated") {
        expect(typeof NOT_GATED_ALLOWLIST[type as UniversalRebacResourceType]).toBe("string");
        expect(
          (NOT_GATED_ALLOWLIST[type as UniversalRebacResourceType] ?? "").length,
        ).toBeGreaterThan(0);
      }
    });
  });

  it("the not_gated allowlist only references registered types", () => {
    const registrySet = new Set<string>(registryTypes);
    for (const t of Object.keys(NOT_GATED_ALLOWLIST)) {
      expect(registrySet.has(t)).toBe(true);
    }
  });
});
