/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("OSS repo management reference app template", () => {
  it("provides a GitHub repository dashboard runtime contract", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const serverSource = readFileSync(
      join(process.cwd(), "apps/agentic-apps/oss-repo-management/server.mjs"),
      "utf8",
    );

    expect(packageJson.scripts["agentic-apps:oss-repo-management"]).toBe(
      "node apps/agentic-apps/oss-repo-management/server.mjs",
    );
    expect(serverSource).toContain("url.pathname === \"/embed\"");
    expect(serverSource).toContain("/api/v1/chat/stream/start");
    expect(serverSource).toContain("agent-github-agent");
    expect(serverSource).toContain("repoInput");
    expect(serverSource).toContain("owner/repo");
    expect(serverSource).toContain("cnoe-io/ai-platform-engineering");
    expect(serverSource).not.toContain("fetchGitHubRepoSummary");
    expect(serverSource).not.toContain("fetchGitHubJson");
    expect(serverSource).not.toContain("https://api.github.com");
    expect(serverSource).not.toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(serverSource).not.toContain('source: "github-rest"');
    expect(serverSource).not.toContain('source: "local-fallback"');
    expect(serverSource).toContain('source: "agent-unavailable"');
    expect(serverSource).toContain("No GitHub structured output received from the CAIPE GitHub agent");
    expect(serverSource).toContain("oss_repo_management.dashboard.v1");
    expect(serverSource).toContain("submit_structured_response");
    expect(serverSource).toContain("response_format");
    expect(serverSource).toContain("repo-health-card");
    expect(serverSource).toContain("maintainer-ask");
    expect(serverSource).toContain("action-grid");
    expect(serverSource).toContain("action-card");
    expect(serverSource).not.toContain("hax-grid");
    expect(serverSource).not.toContain("hax-card");
    expect(serverSource).not.toContain("haxCards");
    expect(serverSource).toContain("Maintainer Action Cards");
    expect(serverSource).toContain("Agent Conversation");
    expect(serverSource).toContain("Repo Assistant");
    expect(serverSource).toContain("Ask Repo Assistant");
    expect(serverSource).not.toContain("HAX Maintainer Cards");
    expect(serverSource).not.toContain("CopilotKit-Ready Conversation");
    expect(serverSource).not.toContain("Repo Copilot");
    expect(serverSource).not.toContain("Ask Repo Copilot");
    expect(serverSource).toContain("fontCustomizer");
    expect(serverSource).toContain("font-dock");
    expect(serverSource).toContain("settingsToggle");
    expect(serverSource).toContain("class=\"settings-fab\"");
    expect(serverSource).toContain("bottom: 24px");
    expect(serverSource).toContain("aria-controls=\"fontCustomizer\"");
    expect(serverSource).toContain("function toggleFontSettings");
    expect(serverSource).toContain("View settings");
    expect(serverSource).toContain("--app-font-scale: 0.8");
    expect(serverSource).toContain("font-size: calc(14px * var(--app-font-scale))");
    expect(serverSource).toContain("kpi-strip");
    expect(serverSource).toContain("insights-strip");
    expect(serverSource).toContain("function renderInsights");
    expect(serverSource).toContain("function kpiTile");
    expect(serverSource).toContain("function formatCount");
    expect(serverSource.indexOf('class="font-customizer font-dock"')).toBeGreaterThan(
      serverSource.indexOf("</section>"),
    );
    expect(serverSource).toContain("runHistory");
    expect(serverSource).toContain("activityFooter");
    expect(serverSource).toContain("streamedContent");
    expect(serverSource).toContain("openAssistantChat");
    expect(serverSource).toContain("caipe.agenticApp.assistant.open.v1");
    expect(serverSource).toContain("caipe.agenticApp.context.v1");
  });
});
