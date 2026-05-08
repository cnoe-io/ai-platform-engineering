/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { validateAgenticAppManifest } from "@/lib/agentic-apps/manifest-validation";

describe("validateAgenticAppManifest", () => {
  const validProxiedManifest = {
    id: "finops",
    displayName: "FinOps Dashboard",
    description: "Cloud cost app",
    apiVersion: "1.0",
    runtime: {
      kind: "proxied-next-zone",
      mountPath: "/apps/finops",
      origin: "http://localhost:3010",
    },
    surfaces: { showInHub: true, homeEligible: true },
    access: { tokenScopes: ["finops:read"] },
    health: { endpoint: "/healthz" },
  };

  it("accepts a valid proxied app manifest", () => {
    expect(validateAgenticAppManifest(validProxiedManifest)).toEqual({
      ok: true,
      manifest: validProxiedManifest,
      warnings: [],
    });
  });

  it("blocks unsupported api versions and route ownership outside /apps", () => {
    const result = validateAgenticAppManifest({
      id: "bad",
      displayName: "Bad",
      description: "Bad app",
      apiVersion: "2.0",
      runtime: { kind: "proxied-next-zone", mountPath: "/admin/bad" },
      surfaces: { showInHub: true },
      access: { tokenScopes: [] },
      health: { endpoint: "/healthz" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation failure");
    }
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "apiVersion must be 1.0",
        "runtime.mountPath must start with /apps/",
      ]),
    );
  });

  it("rejects invalid ids", () => {
    const base = {
      displayName: "X",
      description: "Y",
      apiVersion: "1.0",
      runtime: { kind: "proxied-next-zone", mountPath: "/apps/x" },
      surfaces: { showInHub: true },
      access: { tokenScopes: [] },
      health: { endpoint: "/healthz" },
    };

    const uppercase = validateAgenticAppManifest({
      ...base,
      id: "Invalid",
    });
    expect(uppercase.ok).toBe(false);
    if (uppercase.ok) {
      throw new Error("expected failure");
    }
    expect(uppercase.errors.some((e) => e.includes("id"))).toBe(true);

    const tooShort = validateAgenticAppManifest({ ...base, id: "a" });
    expect(tooShort.ok).toBe(false);

    const badStart = validateAgenticAppManifest({ ...base, id: "-bad" });
    expect(badStart.ok).toBe(false);
  });

  it("rejects embedded secret-like fields but allows access.tokenScopes", () => {
    const secretNested = validateAgenticAppManifest({
      ...validProxiedManifest,
      data: { apiKey: "should-not-appear" },
    });
    expect(secretNested.ok).toBe(false);
    if (secretNested.ok) {
      throw new Error("expected failure for apiKey");
    }
    expect(secretNested.errors.some((e) => e.toLowerCase().includes("secret") || e.includes("apiKey"))).toBe(
      true,
    );

    const allowed = validateAgenticAppManifest({
      ...validProxiedManifest,
      access: { tokenScopes: ["scope:a", "scope:b"] },
    });
    expect(allowed.ok).toBe(true);
  });
});
