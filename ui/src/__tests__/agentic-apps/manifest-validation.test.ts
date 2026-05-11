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

  describe("runtime.chrome", () => {
    it("accepts iframe and fullscreen", () => {
      const iframe = validateAgenticAppManifest({
        ...validProxiedManifest,
        runtime: { ...validProxiedManifest.runtime, chrome: "iframe" },
      });
      expect(iframe.ok).toBe(true);
      if (iframe.ok) {
        expect(iframe.manifest.runtime.chrome).toBe("iframe");
      }

      const fullscreen = validateAgenticAppManifest({
        ...validProxiedManifest,
        runtime: { ...validProxiedManifest.runtime, chrome: "fullscreen" },
      });
      expect(fullscreen.ok).toBe(true);
      if (fullscreen.ok) {
        expect(fullscreen.manifest.runtime.chrome).toBe("fullscreen");
      }
    });

    it("treats omitted chrome as default (no errors, undefined output)", () => {
      const result = validateAgenticAppManifest(validProxiedManifest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.manifest.runtime.chrome).toBeUndefined();
      }
    });

    it("rejects invalid chrome values", () => {
      const result = validateAgenticAppManifest({
        ...validProxiedManifest,
        runtime: { ...validProxiedManifest.runtime, chrome: "popup" },
      });
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected failure");
      }
      expect(
        result.errors.some((e) => e.includes('runtime.chrome must be "fullscreen" or "iframe"')),
      ).toBe(true);
    });
  });

  it("preserves assistant, webhook, PDP, catalog, and health policy contract fields", () => {
    const result = validateAgenticAppManifest({
      ...validProxiedManifest,
      access: {
        ...validProxiedManifest.access,
        policyActions: [
          {
            action: "app.proxy.request",
            description: "Forward proxied app requests",
            defaultEffect: "deny",
          },
        ],
      },
      assistant: {
        enabled: true,
        schemaVersions: ["1.0"],
        maxContextBytes: 4096,
        capability: "contextual-chat",
        suggestions: true,
      },
      webhooks: [
        {
          provider: "github",
          channel: "repo-events",
          upstreamPath: "/webhooks/github",
          allowedMethods: ["POST"],
          verificationOwner: "app",
          preservedHeaders: ["x-github-event", "x-hub-signature-256"],
          maxBodyBytes: 65536,
          policyAction: "app.webhook.forward",
        },
      ],
      health: {
        ...validProxiedManifest.health,
        blockLaunchWhen: ["degraded", "unreachable"],
      },
      catalog: {
        categories: ["developer-tools"],
        capabilities: ["webhooks", "assistant-context"],
        icon: "weather",
        supportUrl: "https://example.com/support",
        compatibility: "^1.0.0",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected success: ${result.errors.join(", ")}`);
    }
    expect(result.manifest.access.policyActions?.[0]?.action).toBe("app.proxy.request");
    expect(result.manifest.assistant?.maxContextBytes).toBe(4096);
    expect(result.manifest.webhooks?.[0]?.preservedHeaders).toContain("x-hub-signature-256");
    expect(result.manifest.health.blockLaunchWhen).toEqual(["degraded", "unreachable"]);
    expect(result.manifest.catalog?.capabilities).toContain("assistant-context");
  });

  it("rejects malformed assistant, webhook, PDP, catalog, and health policy fields", () => {
    const result = validateAgenticAppManifest({
      ...validProxiedManifest,
      access: {
        tokenScopes: ["finops:read"],
        policyActions: [{ description: "missing action", defaultEffect: "maybe" }],
      },
      assistant: {
        enabled: "true",
        schemaVersions: ["1.0", 2],
        maxContextBytes: 0,
      },
      webhooks: [
        {
          provider: "github",
          channel: "repo-events",
          upstreamPath: "relative",
          allowedMethods: ["GET"],
          verificationOwner: "someone-else",
          maxBodyBytes: 0,
        },
      ],
      health: {
        endpoint: "/healthz",
        blockLaunchWhen: ["offline"],
      },
      catalog: {
        supportUrl: 123,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation failure");
    }
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "access.policyActions[0].action must be a non-empty string",
        'access.policyActions[0].defaultEffect must be "allow" or "deny" when present',
        "assistant.enabled must be a boolean when present",
        "assistant.schemaVersions must be an array of strings when present",
        "assistant.maxContextBytes must be between 1 and 65536 when present",
        "webhooks[0].upstreamPath must start with /",
        "webhooks[0].allowedMethods must include only POST or PUT",
        'webhooks[0].verificationOwner must be "app" or "caipe"',
        "webhooks[0].maxBodyBytes must be between 1 and 10485760",
        "health.blockLaunchWhen must include only unknown, degraded, or unreachable",
        "catalog.supportUrl must be a string when present",
      ]),
    );
  });

  it("rejects duplicate webhook provider/channel declarations", () => {
    const result = validateAgenticAppManifest({
      ...validProxiedManifest,
      webhooks: [
        {
          provider: "github",
          channel: "repo-events",
          upstreamPath: "/webhooks/github",
          allowedMethods: ["POST"],
          verificationOwner: "app",
          maxBodyBytes: 1024,
        },
        {
          provider: "github",
          channel: "repo-events",
          upstreamPath: "/webhooks/github-duplicate",
          allowedMethods: ["POST"],
          verificationOwner: "app",
          maxBodyBytes: 1024,
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected duplicate webhook validation failure");
    }
    expect(result.errors).toContain('webhooks must not duplicate provider/channel "github/repo-events"');
  });
});
