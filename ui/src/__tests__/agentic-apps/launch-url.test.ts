/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { resolveAgenticAppLaunchUrl } from "@/lib/agentic-apps/launch-url";
import type { AgenticAppManifest } from "@/types/agentic-app";

const baseManifest: AgenticAppManifest = {
  id: "demo",
  displayName: "Demo",
  description: "Demo app",
  apiVersion: "1.0",
  runtime: { kind: "proxied-next-zone", mountPath: "/apps/demo" },
  surfaces: { showInHub: true },
  access: { tokenScopes: [] },
  health: { endpoint: "/healthz" },
};

describe("resolveAgenticAppLaunchUrl", () => {
  it("returns mountPath for fullscreen (default) chrome", () => {
    expect(resolveAgenticAppLaunchUrl(baseManifest)).toBe("/apps/demo");
  });

  it("returns mountPath for explicit fullscreen chrome", () => {
    const m: AgenticAppManifest = {
      ...baseManifest,
      runtime: { ...baseManifest.runtime, chrome: "fullscreen" },
    };
    expect(resolveAgenticAppLaunchUrl(m)).toBe("/apps/demo");
  });

  it("returns /apps/embed/<id> for iframe chrome", () => {
    const m: AgenticAppManifest = {
      ...baseManifest,
      runtime: { ...baseManifest.runtime, chrome: "iframe" },
    };
    expect(resolveAgenticAppLaunchUrl(m)).toBe("/apps/embed/demo");
  });

  it("respects physicalHref override only for fullscreen apps", () => {
    const fullscreen = resolveAgenticAppLaunchUrl(baseManifest, "/custom/demo");
    expect(fullscreen).toBe("/custom/demo");

    const iframeManifest: AgenticAppManifest = {
      ...baseManifest,
      runtime: { ...baseManifest.runtime, chrome: "iframe" },
    };
    // Override is intentionally ignored for iframe chrome — the embed page
    // resolves the physical mountPath itself, ensuring the iframe always
    // points at the proxy and can never be redirected to the embed page
    // (which would recurse).
    const iframe = resolveAgenticAppLaunchUrl(iframeManifest, "/custom/demo");
    expect(iframe).toBe("/apps/embed/demo");
  });
});
