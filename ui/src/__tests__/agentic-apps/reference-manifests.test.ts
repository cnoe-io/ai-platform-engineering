/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { validateAgenticAppManifest } from "@/lib/agentic-apps/manifest-validation";

describe("reference app manifests", () => {
  it("validates FinOps, Weather, OSS Repo Management, Jira Project Dashboard, and Agentic SDLC app-owned manifests", async () => {
    const [
      { FINOPS_MANIFEST },
      { WEATHER_MANIFEST },
      { OSS_REPO_MANAGEMENT_MANIFEST },
      { JIRA_PROJECT_DASHBOARD_MANIFEST },
      { AGENTIC_SDLC_MANIFEST },
    ] = await Promise.all([
      import("../../../apps/agentic-apps/finops/manifest.mjs"),
      import("../../../apps/agentic-apps/weather/manifest.mjs"),
      import("../../../apps/agentic-apps/oss-repo-management/manifest.mjs"),
      import("../../../apps/agentic-apps/jira-project-dashboard/manifest.mjs"),
      import("../../../apps/agentic-sdlc/manifest.mjs"),
    ]);

    for (const manifest of [
      FINOPS_MANIFEST,
      WEATHER_MANIFEST,
      OSS_REPO_MANAGEMENT_MANIFEST,
      JIRA_PROJECT_DASHBOARD_MANIFEST,
      AGENTIC_SDLC_MANIFEST,
    ]) {
      const result = validateAgenticAppManifest(manifest);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.errors.join(", "));
      }
      expect(result.manifest.runtime.kind).toBe("proxied-next-zone");
      expect(result.manifest.runtime.mountPath).toMatch(/^\/apps\//);
    }
  });
});
