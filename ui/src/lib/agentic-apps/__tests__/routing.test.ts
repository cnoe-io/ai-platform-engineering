import type { AgenticAppManifest } from "@/types/agentic-app";

import { resolveAgenticAppLaunchUrl } from "../launch-url";
import { buildAgenticAppRuntimePath } from "../runtime-path";

function manifest(chrome: "fullscreen" | "iframe"): AgenticAppManifest {
  return {
    id: "example-app",
    displayName: "Example App",
    description: "Example",
    apiVersion: "1.0",
    runtime: {
      kind: "proxied-next-zone",
      mountPath: "/apps/example-app",
      chrome,
    },
    surfaces: { showInHub: true },
    access: { tokenScopes: [] },
    health: { endpoint: "/healthz", timeoutMs: 1000 },
  };
}

describe("Agentic App routing", () => {
  it("uses the canonical app URL for iframe apps", () => {
    expect(resolveAgenticAppLaunchUrl(manifest("iframe"))).toBe("/apps/example-app");
  });

  it("keeps fullscreen apps on their physical mount path", () => {
    expect(resolveAgenticAppLaunchUrl(manifest("fullscreen"), "/apps/custom-app")).toBe(
      "/apps/custom-app",
    );
  });

  it("builds an encoded private runtime path for deep links", () => {
    expect(buildAgenticAppRuntimePath("example-app", ["reports", "week 1"])).toBe(
      "/api/agentic-apps/runtime/example-app/reports/week%201",
    );
  });
});
