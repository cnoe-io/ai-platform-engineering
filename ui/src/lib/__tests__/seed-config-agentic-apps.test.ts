/**
 * @jest-environment node
 */

import { mkdtempSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const collections = new Map<string,MockCollection>();

class MockCollection {
  constructor(private readonly documents: Record<string, unknown>[] = []) {}

  updateOne = jest.fn();
  deleteOne = jest.fn();
  findOne = jest.fn().mockResolvedValue(null);
  find = jest.fn().mockReturnValue({
    toArray: jest.fn().mockImplementation(async () => this.documents),
  });
}

function validSeed(appId = "example-app") {
  return {
    packages: [
      {
        package_id: appId,
        manifest: {
          id: appId,
          displayName: "Example App",
          description: "Config-driven external app.",
          apiVersion: "1.0",
          runtime: {
            kind: "proxied-next-zone",
            mountPath: `/apps/${appId}`,
            origin: "http://example-app.example.svc:80",
            chrome: "iframe",
          },
          surfaces: { showInHub: true },
          access: { requiredRoles: ["user"],tokenScopes: [`${appId}:read`] },
          health: { endpoint: "/healthz" },
        },
      },
    ],
    installations: [
      {
        app_id: appId,
        package_id: appId,
        runtime_mount_path: `/apps/${appId}`,
        runtime_origin_override: "http://example-app.example.svc:80",
      },
    ],
  };
}

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async (name: string) => {
    let collection = collections.get(name);
    if (!collection) {
      collection = new MockCollection();
      collections.set(name, collection);
    }
    return collection;
  }),
}));

describe("config-driven Agentic Apps", () => {
  beforeEach(() => {
    collections.clear();
    jest.clearAllMocks();
  });

  it("loads a dedicated Agentic Apps config and seeds package and installation records", async () => {
    const dir = mkdtempSync(join(tmpdir(), "caipe-agentic-apps-"));
    const appConfigPath = join(dir, "app-config.yaml");
    const agenticAppsConfigPath = join(dir, "agentic-apps.yaml");

    try {
      writeFileSync(
        appConfigPath,
        [
          "models: []",
          "mcp_servers: []",
          "agents: []",
          "workflow_configs: []",
          "rag_sources: []",
        ].join("\n"),
      );
      writeFileSync(
        agenticAppsConfigPath,
        [
          "agentic_apps:",
          "  packages:",
          "    - package_id: example-app",
          "      manifest:",
          "        id: example-app",
          "        displayName: Example App",
          "        description: Config-driven external app.",
          '        apiVersion: "1.0"',
          "        runtime:",
          "          kind: proxied-next-zone",
          "          mountPath: /apps/example-app",
          "          origin: ${EXAMPLE_APP_ORIGIN}",
          "          chrome: iframe",
          "        surfaces:",
          "          showInHub: true",
          "        access:",
          "          requiredRoles: [user]",
          "          tokenScopes: [example-app:read]",
          "        health:",
          "          endpoint: /healthz",
          "  installations:",
          "    - app_id: example-app",
          "      package_id: example-app",
          "      runtime_mount_path: /apps/example-app",
          "      runtime_origin_override: ${EXAMPLE_APP_ORIGIN}",
        ].join("\n"),
      );
      process.env.EXAMPLE_APP_ORIGIN = "http://example-app.example.svc:80";

      const {
        loadSeedConfig,
        resolveAgenticAppsSeedSource,
        seedAgenticApps,
      } = await import("../seed-config");
      const baseConfig = loadSeedConfig(appConfigPath);
      const source = resolveAgenticAppsSeedSource(
        baseConfig,
        appConfigPath,
        agenticAppsConfigPath,
      );

      expect(source).not.toBeNull();
      await seedAgenticApps(source!.config,source!.configPath);

      expect(collections.get("agentic_app_packages")?.updateOne).toHaveBeenCalledWith(
        { packageId: "example-app" },
        expect.objectContaining({
          $set: expect.objectContaining({
            packageId: "example-app",
            source: "helm",
            config_driven: true,
            manifest: expect.objectContaining({
              id: "example-app",
              runtime: expect.objectContaining({
                origin: "http://example-app.example.svc:80",
              }),
            }),
          }),
        }),
        { upsert: true },
      );
      expect(collections.get("agentic_app_installations")?.updateOne).toHaveBeenCalledWith(
        { appId: "example-app" },
        expect.objectContaining({
          $set: expect.objectContaining({
            appId: "example-app",
            packageId: "example-app",
            installed: true,
            enabled: true,
            visible: true,
            runtimeMountPath: "/apps/example-app",
            runtimeOriginOverride: "http://example-app.example.svc:80",
            routeOwnership: { normalizedMountPath: "/apps/example-app" },
            config_driven: true,
          }),
        }),
        { upsert: true },
      );
      const installationUpdate = collections.get("agentic_app_installations")
        ?.updateOne.mock.calls[0]?.[1];
      expect(installationUpdate.$set).not.toHaveProperty("runtimeHealth");
      expect(installationUpdate.$setOnInsert).toEqual(
        expect.objectContaining({ runtimeHealth: "unknown" }),
      );
    } finally {
      delete process.env.EXAMPLE_APP_ORIGIN;
      rmSync(dir,{ recursive: true,force: true });
    }
  });

  it("does not reconcile Agentic Apps when neither config file declares them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "caipe-no-agentic-apps-"));
    const appConfigPath = join(dir, "app-config.yaml");

    try {
      writeFileSync(appConfigPath,"models: []\n");
      const { loadSeedConfig,resolveAgenticAppsSeedSource } = await import(
        "../seed-config"
      );
      const config = loadSeedConfig(appConfigPath);
      expect(resolveAgenticAppsSeedSource(config,appConfigPath,undefined)).toBeNull();
    } finally {
      rmSync(dir,{ recursive: true,force: true });
    }
  });

  it("rejects malformed root arrays instead of treating them as an empty desired set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "caipe-invalid-agentic-apps-"));
    const configPath = join(dir, "agentic-apps.yaml");
    try {
      writeFileSync(
        configPath,
        "agentic_apps:\n  packages: {}\n  installations: []\n",
      );
      const { loadSeedConfig } = await import("../seed-config");
      expect(() => loadSeedConfig(configPath)).toThrow(
        "agentic_apps.packages must be an array",
      );
      expect(collections.size).toBe(0);
    } finally {
      rmSync(dir,{ recursive: true,force: true });
    }
  });

  it("preflights package references and access override keys before any write", async () => {
    const { seedAgenticApps } = await import("../seed-config");
    const missingPackage = validSeed();
    missingPackage.installations[0].package_id = "missing-package";
    await expect(seedAgenticApps(missingPackage,"/tmp/config.yaml")).rejects.toThrow(
      /references package "missing-package" that is not configured/,
    );

    const unsupportedAccess = validSeed();
    Object.assign(unsupportedAccess.installations[0], {
      access_overrides: { tenants: ["example"] },
    });
    await expect(seedAgenticApps(unsupportedAccess,"/tmp/config.yaml")).rejects.toThrow(
      /unknown key "tenants"/,
    );
    for (const collection of collections.values()) {
      expect(collection.updateOne).not.toHaveBeenCalled();
      expect(collection.deleteOne).not.toHaveBeenCalled();
    }
  });

  it("replaces a stale config-owned route in one reconciliation", async () => {
    collections.set(
      "agentic_app_installations",
      new MockCollection([
        {
          appId: "old-app",
          packageId: "old-app",
          installed: true,
          config_driven: true,
          routeOwnership: { normalizedMountPath: "/apps/new-app" },
        },
      ]),
    );
    collections.set(
      "agentic_app_packages",
      new MockCollection([
        { packageId: "old-app",config_driven: true },
      ]),
    );
    const { seedAgenticApps } = await import("../seed-config");
    await seedAgenticApps(validSeed("new-app"),"/tmp/config.yaml");

    expect(collections.get("agentic_app_installations")?.updateOne).toHaveBeenCalledWith(
      { appId: "new-app" },
      expect.any(Object),
      { upsert: true },
    );
    expect(collections.get("agentic_app_installations")?.deleteOne).toHaveBeenCalledWith({
      appId: "old-app",
    });
    expect(collections.get("agentic_app_packages")?.deleteOne).toHaveBeenCalledWith({
      packageId: "old-app",
    });
  });

  it("rejects an admin-owned route conflict before writing", async () => {
    collections.set(
      "agentic_app_installations",
      new MockCollection([
        {
          appId: "admin-app",
          packageId: "admin-app",
          installed: true,
          config_driven: false,
          routeOwnership: { normalizedMountPath: "/apps/new-app" },
        },
      ]),
    );
    collections.set("agentic_app_packages",new MockCollection());
    const { seedAgenticApps } = await import("../seed-config");
    await expect(
      seedAgenticApps(validSeed("new-app"),"/tmp/config.yaml"),
    ).rejects.toThrow(/owned by admin-managed app "admin-app"/);
    for (const collection of collections.values()) {
      expect(collection.updateOne).not.toHaveBeenCalled();
      expect(collection.deleteOne).not.toHaveBeenCalled();
    }
  });
});
