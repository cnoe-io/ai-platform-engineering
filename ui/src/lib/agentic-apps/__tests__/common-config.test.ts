/** @jest-environment node */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import example from "../../../../examples/agentic-apps/shared/manifest.json";
import {
  validateAgenticAppManifest,
  normalizeNativeExtensionManifest,
} from "../../../../native-extension-sdk/agentic-app-manifest.mjs";
import {
  installedAgenticAppManifests,
  installedLegacyNativeExtensionIds,
} from "@/native-extensions/manifests.generated";
import { canLaunchAgenticApp } from "../access";
import { loadConfiguredAgenticApps } from "../config";
import {
  agenticAppEntryHref,
  buildPublicAgenticApp,
  nativeAgenticAppDestination,
} from "../public-app";

jest.mock("@/native-extensions/manifests.generated", () => ({
  installedAgenticAppManifests: [],
  installedLegacyNativeExtensionIds: [],
}));

describe("shared application installation", () => {
  const previousEnabled = process.env.AGENTIC_APPS_INSTALL_ENABLED;
  beforeEach(() => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    installedAgenticAppManifests.splice(0);
    installedLegacyNativeExtensionIds.splice(0);
  });
  afterAll(() => {
    if (previousEnabled === undefined)
      delete process.env.AGENTIC_APPS_INSTALL_ENABLED;
    else process.env.AGENTIC_APPS_INSTALL_ENABLED = previousEnabled;
  });

  function configured(
    manifest: unknown | undefined,
    installation: Record<string, unknown>,
  ) {
    const dir = mkdtempSync(join(tmpdir(), "app-installation-"));
    const file = join(dir, "apps.yaml");
    try {
      writeFileSync(
        file,
        JSON.stringify({
          agentic_apps: {
            packages: manifest ? [{ package_id: "example-app", manifest }] : [],
            installations: [{ app_id: "example-app", ...installation }],
          },
        }),
      );
      return loadConfiguredAgenticApps(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("one compiled manifest supports selecting either UI with the same services and capabilities", () => {
    installedAgenticAppManifests.push(validateAgenticAppManifest(example));
    for (const profile of ["native", "hosted"]) {
      const [app] = configured(undefined, {
        selected_ui_profile: profile,
        app_version: "1.0.0",
        bindings: {
          runtimeOrigin: "https://runtime.example.test",
          resources: { assistant: "example-agent" },
        },
      });
      expect(app.manifest.provides.mcp).toEqual(["example-mcp"]);
      expect(app.installation.bindings.resources.assistant).toBe(
        "example-agent",
      );
      expect(agenticAppEntryHref(app)).toBe(
        profile === "native" ? "/example" : "/apps/example-app",
      );
      expect(buildPublicAgenticApp(app, true)).not.toHaveProperty("bindings");
    }
  });

  it("rejects a runtime request to enable native code missing from the image", () => {
    expect(() =>
      configured(example, {
        selected_ui_profile: "native",
        bindings: { runtimeOrigin: "https://runtime.example.test" },
      }),
    ).toThrow(/not compiled/);
  });

  it("preserves owned canonical and relative aliases without escaping into host pages", () => {
    const publicApp = {
      appId: "example-app",
      displayName: "Example",
      description: "Example",
      href: "/example",
      canLaunch: true,
      blockedReasons: [],
      categories: [],
      capabilities: [],
      uiMode: "native-package" as const,
      hostPaths: ["/example"],
    };
    expect(
      nativeAgenticAppDestination(
        publicApp,
        ["example", "items", "one"],
        "view=full",
      ),
    ).toBe("/example/items/one?view=full");
    expect(nativeAgenticAppDestination(publicApp, ["items", "one"], "")).toBe(
      "/example/items/one",
    );
    expect(nativeAgenticAppDestination(publicApp, ["..", "admin"], "")).toBe(
      "/example",
    );
    expect(nativeAgenticAppDestination(publicApp, ["admin"], "")).toBe(
      "/example/admin",
    );
  });

  it("permits the same publisher manifest in a hosted installation without native code", () => {
    const [app] = configured(example, {
      selected_ui_profile: "hosted",
      bindings: { runtimeOrigin: "https://runtime.example.test" },
    });
    expect(app.installation.selectedUiProfile).toBe("hosted");
  });

  it("rejects a second mutable declaration of a compiled manifest", () => {
    installedAgenticAppManifests.push(validateAgenticAppManifest(example));
    expect(() =>
      configured(example, { selected_ui_profile: "hosted" }),
    ).toThrow(/pinned package/);
  });

  it("preserves role and service policy when migrating a native v1.1 deployment", () => {
    const native = normalizeNativeExtensionManifest(
      {
        id: "example-app",
        displayName: "Example",
        description: "Example",
        hostPaths: ["/example"],
        api: { mounts: ["/api/example"] },
        auth: { mode: "app-scoped-token" },
      },
      "@example/native-app",
      "1.0.0",
    );
    installedAgenticAppManifests.push(native);
    installedLegacyNativeExtensionIds.push(native.id);
    const legacy = {
      id: "example-app",
      displayName: "Example",
      description: "Example",
      apiVersion: "1.0",
      runtime: { kind: "proxied-next-zone", mountPath: "/apps/example-app" },
      surfaces: { showInHub: true },
      access: {
        requiredRoles: ["admin"],
        tokenScopes: ["example:read"],
        policyActions: [{ action: "proxy:GET", defaultEffect: "allow" }],
      },
    };
    const [app] = configured(legacy, {
      runtime_origin_override: "https://runtime.example.test",
    });
    expect(app.installation.selectedUiProfile).toBe("native");
    expect(app.manifest.ui.routes[0].path).toBe("/example");
    expect(app.manifest.access.requiredRoles).toEqual(["admin"]);
    expect(canLaunchAgenticApp(app, { role: "user" })).toBe(false);
    expect(() =>
      configured(
        { ...legacy, auth: { mode: "forward-user-access-token" } },
        { runtime_origin_override: "https://runtime.example.test" },
      ),
    ).toThrow(/auth mode/);
  });

  it("does not let a legacy deployment overwrite a new pinned manifest's policy", () => {
    installedAgenticAppManifests.push(validateAgenticAppManifest(example));
    const legacy = {
      id: "example-app",
      displayName: "Example",
      description: "Example",
      apiVersion: "1.0",
      runtime: { kind: "proxied-next-zone", mountPath: "/apps/example-app" },
      surfaces: { showInHub: true },
      access: {
        tokenScopes: ["example:admin"],
        policyActions: [{ action: "proxy:GET", defaultEffect: "allow" }],
      },
    };
    expect(() =>
      configured(legacy, {
        runtime_origin_override: "https://runtime.example.test",
      }),
    ).toThrow(/pinned package/);
  });

  it("checks selected profile, artifact version and private runtime bindings", () => {
    installedAgenticAppManifests.push(validateAgenticAppManifest(example));
    expect(() =>
      configured(undefined, { selected_ui_profile: "missing" }),
    ).toThrow(/not declared/);
    expect(() =>
      configured(undefined, {
        bindings: { runtimeOrigin: "https://runtime.example.test" },
      }),
    ).toThrow(/explicit UI profile/);
    expect(() => configured(undefined, { app_version: "2.0.0" })).toThrow(
      /artifact/,
    );
    expect(() =>
      configured(undefined, {
        bindings: { runtimeOrigin: "file:///tmp/example" },
      }),
    ).toThrow(/HTTP/);
    expect(() =>
      configured(undefined, {
        bindings: {
          runtimeOrigin: "https://runtime.example.test",
          token: "secret",
        },
      }),
    ).toThrow(/unknown key/);
  });

  it("supports a UI-only compiled app without a fake backend binding", () => {
    const app = {
      ...example,
      ui: {
        ...example.ui,
        profiles: example.ui.profiles.filter(
          (profile) => profile.mode === "native-package",
        ),
      },
      runtime: undefined,
      api: { mounts: [] },
      access: { requiredRoles: ["user"], tokenScopes: [], policyActions: [] },
    };
    installedAgenticAppManifests.push(validateAgenticAppManifest(app));
    const [configuredApp] = configured(undefined, {});
    expect(configuredApp.manifest.runtime).toBeUndefined();
    expect(agenticAppEntryHref(configuredApp)).toBe("/example");
  });

  it("keeps permission requests declarative and hidden apps protected", () => {
    installedAgenticAppManifests.push(validateAgenticAppManifest(example));
    const [app] = configured(undefined, {
      selected_ui_profile: "native",
      visible: false,
      bindings: { runtimeOrigin: "https://runtime.example.test" },
    });
    expect(app.manifest.requestedPermissions).toHaveLength(1);
    expect(canLaunchAgenticApp(app, { role: "user" })).toBe(true);
    expect(canLaunchAgenticApp(app, { role: "viewer" })).toBe(false);
    expect(app.installation).not.toHaveProperty("grants");
  });

  it("registers service-only apps without advertising UI or requiring native modules", () => {
    const manifest = {
      ...example,
      ui: { profiles: [], routes: [] },
      api: { mounts: [] },
      surfaces: { showInHub: false },
    };
    const [app] = configured(manifest, {
      bindings: { runtimeOrigin: "https://runtime.example.test" },
    });
    expect(app.manifest.ui.profiles).toEqual([]);
    expect(app.installation.selectedUiProfile).toBeUndefined();
  });
});
