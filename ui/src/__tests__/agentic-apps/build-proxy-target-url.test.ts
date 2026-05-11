/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 *
 * Pins the contract for buildProxyTargetUrl, including the `preserveMountPath`
 * option used by apps that rely on a framework basePath (e.g. Next.js apps
 * that expect to see their own `/apps/<id>` prefix). The default-off branch
 * must keep working for apps that serve their content at "/" and don't care
 * about the prefix (the FinOps and Weather samples).
 */

import {
  buildProxyTargetUrl,
  resolveEffectiveRuntimeOrigin,
} from "@/lib/agentic-apps/execution-gateway";
import type {
  AgenticAppInstallationRecord,
  AgenticAppManifest,
} from "@/types/agentic-app";

describe("resolveEffectiveRuntimeOrigin", () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  function makeManifest(overrides: Partial<AgenticAppManifest> = {}): AgenticAppManifest {
    return {
      id: "acme-app",
      displayName: "Acme App",
      description: "test",
      apiVersion: "1.0",
      runtime: { kind: "proxied-next-zone", mountPath: "/apps/acme-app" },
      surfaces: { showInHub: true },
      access: { tokenScopes: [] },
      health: { endpoint: "/" },
      ...overrides,
    } as AgenticAppManifest;
  }

  function makeInstallation(overrides: Partial<AgenticAppInstallationRecord> = {}): AgenticAppInstallationRecord {
    return {
      appId: "acme-app",
      packageId: "acme-app",
      installed: true,
      enabled: true,
      ...overrides,
    };
  }

  it("prefers installation.runtimeOriginOverride above all else", () => {
    process.env = {
      ...ORIGINAL_ENV,
      AGENTIC_APP_ACME_APP_ORIGIN: "http://from-env:9999",
    };
    const m = makeManifest({
      runtime: {
        kind: "proxied-next-zone",
        mountPath: "/apps/acme-app",
        origin: "http://from-manifest:8888",
      },
    });
    const i = makeInstallation({ runtimeOriginOverride: "http://from-install:7777" });

    expect(resolveEffectiveRuntimeOrigin(i, m)).toBe("http://from-install:7777");
  });

  it("falls back to manifest.runtime.origin when no install override", () => {
    process.env = { ...ORIGINAL_ENV, AGENTIC_APP_ACME_APP_ORIGIN: "http://from-env:9999" };
    const m = makeManifest({
      runtime: {
        kind: "proxied-next-zone",
        mountPath: "/apps/acme-app",
        origin: "http://from-manifest:8888",
      },
    });
    const i = makeInstallation();

    expect(resolveEffectiveRuntimeOrigin(i, m)).toBe("http://from-manifest:8888");
  });

  it("falls back to AGENTIC_APP_<ID>_ORIGIN env var when neither is set (built-in apps)", () => {
    process.env = { ...ORIGINAL_ENV, AGENTIC_APP_ACME_APP_ORIGIN: "http://from-env:9999" };
    const m = makeManifest();
    const i = makeInstallation();

    expect(resolveEffectiveRuntimeOrigin(i, m)).toBe("http://from-env:9999");
  });

  it("normalizes hyphens in app ids when reading env (e.g. 'agentic-sdlc' -> AGENTIC_APP_AGENTIC_SDLC_ORIGIN)", () => {
    process.env = { ...ORIGINAL_ENV, AGENTIC_APP_AGENTIC_SDLC_ORIGIN: "http://sdlc:1111" };
    const m = makeManifest({ id: "agentic-sdlc" });
    const i = makeInstallation({ appId: "agentic-sdlc", packageId: "agentic-sdlc" });

    expect(resolveEffectiveRuntimeOrigin(i, m)).toBe("http://sdlc:1111");
  });

  it("returns undefined when no source provides an origin", () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.AGENTIC_APP_ACME_APP_ORIGIN;
    const m = makeManifest();
    const i = makeInstallation();

    expect(resolveEffectiveRuntimeOrigin(i, m)).toBeUndefined();
  });

  it("treats whitespace-only env values as missing", () => {
    process.env = { ...ORIGINAL_ENV, AGENTIC_APP_ACME_APP_ORIGIN: "   " };
    const m = makeManifest();
    const i = makeInstallation();

    expect(resolveEffectiveRuntimeOrigin(i, m)).toBeUndefined();
  });
});

describe("buildProxyTargetUrl", () => {
  const requestUrl = "https://caipe.example/apps/acme-app/projects/foo?id=42";

  it("strips the public mount path by default (legacy behavior)", () => {
    const target = buildProxyTargetUrl(
      "http://localhost:3001",
      ["projects", "foo"],
      requestUrl,
    );

    expect(target).toBe("http://localhost:3001/projects/foo?id=42");
  });

  it("returns origin root when no path parts are given (legacy behavior)", () => {
    const target = buildProxyTargetUrl("http://localhost:3001", [], requestUrl);

    expect(target).toBe("http://localhost:3001/?id=42");
  });

  it("preserves the public mount path when preserveMountPath is true", () => {
    const target = buildProxyTargetUrl(
      "http://localhost:3001",
      ["projects", "foo"],
      requestUrl,
      { preserveMountPath: true, mountPath: "/apps/acme-app" },
    );

    expect(target).toBe("http://localhost:3001/apps/acme-app/projects/foo?id=42");
  });

  it("preserves the public mount path when path is empty", () => {
    const target = buildProxyTargetUrl("http://localhost:3001", [], requestUrl, {
      preserveMountPath: true,
      mountPath: "/apps/acme-app",
    });

    expect(target).toBe("http://localhost:3001/apps/acme-app?id=42");
  });

  it("preserveMountPath is a no-op when mountPath is missing", () => {
    const target = buildProxyTargetUrl(
      "http://localhost:3001",
      ["projects", "foo"],
      requestUrl,
      { preserveMountPath: true },
    );

    expect(target).toBe("http://localhost:3001/projects/foo?id=42");
  });

  it("normalizes a trailing-slash mountPath", () => {
    const target = buildProxyTargetUrl(
      "http://localhost:3001",
      ["projects"],
      requestUrl,
      { preserveMountPath: true, mountPath: "/apps/acme-app/" },
    );

    expect(target).toBe("http://localhost:3001/apps/acme-app/projects?id=42");
  });

  it("encodes special characters within a single path segment", () => {
    // Each entry of `pathParts` is a single decoded segment; `/`, `?`, and `#`
    // inside a segment must be encoded so they cannot terminate the path or
    // inject new query parameters.
    const target = buildProxyTargetUrl(
      "http://localhost:3001",
      ["a/b?c"],
      requestUrl,
      { preserveMountPath: true, mountPath: "/apps/acme-app" },
    );

    expect(target).toBe("http://localhost:3001/apps/acme-app/a%2Fb%3Fc?id=42");
  });
});
