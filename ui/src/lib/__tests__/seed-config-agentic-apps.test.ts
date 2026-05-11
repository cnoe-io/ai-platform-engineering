/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const collections = new Map<string, MockCollection>();

class MockCollection {
  replaceOne = jest.fn();
  updateOne = jest.fn();
  deleteOne = jest.fn();
  findOne = jest.fn().mockResolvedValue(null);
  find = jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue([]),
  });
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

describe("seed-config agentic apps", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    collections.clear();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("seeds external agentic app packages and installations from app config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "caipe-agentic-apps-"));
    const manifestPath = join(dir, "demo-catalog-app.manifest.json");
    const configPath = join(dir, "app-config.yaml");

    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "demo-catalog-app",
        displayName: "Demo Catalog App",
        description: "External catalog demo app.",
        apiVersion: "1.0",
        runtime: {
          kind: "proxied-next-zone",
          mountPath: "/apps/demo-catalog-app",
          chrome: "iframe",
        },
        surfaces: {
          showInHub: true,
        },
        access: {
          requiredRoles: ["user"],
          tokenScopes: ["demo-catalog-app:read"],
        },
        health: {
          endpoint: "/healthz",
        },
      }),
    );
    writeFileSync(
      configPath,
      [
        "models: []",
        "mcp_servers: []",
        "agents: []",
        "agentic_apps:",
        "  packages:",
        "    - package_id: demo-catalog-app",
        "      source: admin-import",
        `      manifest_path: ${manifestPath}`,
        "  installations:",
        "    - app_id: demo-catalog-app",
        "      package_id: demo-catalog-app",
        "      enabled: true",
        "      visible: true",
        "      runtime_mount_path: /apps/demo-catalog-app",
        "      runtime_origin_override: ${DEMO_CATALOG_APP_ORIGIN:-http://host.docker.internal:3001}",
      ].join("\n"),
    );
    process.env.APP_CONFIG_PATH = configPath;
    process.env.DEMO_CATALOG_APP_ORIGIN = "http://external-demo-catalog-app:3001";

    const { applySeedConfig } = await import("@/lib/seed-config");
    await applySeedConfig();

    const packages = collections.get("agentic_app_packages");
    const installations = collections.get("agentic_app_installations");

    expect(packages?.updateOne).toHaveBeenCalledWith(
      { packageId: "demo-catalog-app" },
      expect.objectContaining({
        $set: expect.objectContaining({
          packageId: "demo-catalog-app",
          source: "admin-import",
          config_driven: true,
          manifest: expect.objectContaining({
            id: "demo-catalog-app",
            displayName: "Demo Catalog App",
          }),
        }),
      }),
      { upsert: true },
    );
    expect(installations?.updateOne).toHaveBeenCalledWith(
      { appId: "demo-catalog-app" },
      expect.objectContaining({
        $set: expect.objectContaining({
          appId: "demo-catalog-app",
          packageId: "demo-catalog-app",
          installed: true,
          enabled: true,
          visible: true,
          config_driven: true,
          runtimeMountPath: "/apps/demo-catalog-app",
          runtimeOriginOverride: "http://external-demo-catalog-app:3001",
          routeOwnership: { normalizedMountPath: "/apps/demo-catalog-app" },
        }),
      }),
      { upsert: true },
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("preserves structured-response middleware for config-driven agents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "caipe-agent-config-"));
    const configPath = join(dir, "app-config.yaml");

    writeFileSync(
      configPath,
      [
        "models: []",
        "mcp_servers: []",
        "agents:",
        "  - id: agent-jira-agent",
        "    name: Jira Agent",
        "    system_prompt: Emit Jira dashboard data.",
        "    model:",
        "      id: test-model",
        "      provider: test-provider",
        "    features:",
        "      middleware:",
        "        - type: structured_response",
        "          enabled: true",
        "          params:",
        "            allowed_schema_ids: jira_project.dashboard.v1",
        "            require_tool_submission: true",
        "agentic_apps:",
        "  packages: []",
        "  installations: []",
      ].join("\n"),
    );
    process.env.APP_CONFIG_PATH = configPath;

    const { applySeedConfig } = await import("@/lib/seed-config");
    await applySeedConfig();

    const agents = collections.get("dynamic_agents");
    expect(agents?.replaceOne).toHaveBeenCalledWith(
      { _id: "agent-jira-agent" },
      expect.objectContaining({
        _id: "agent-jira-agent",
        features: {
          middleware: [
            {
              type: "structured_response",
              enabled: true,
              params: {
                allowed_schema_ids: "jira_project.dashboard.v1",
                require_tool_submission: true,
              },
            },
          ],
        },
      }),
      { upsert: true },
    );

    rmSync(dir, { recursive: true, force: true });
  });
});
