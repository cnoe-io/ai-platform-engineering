/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Jira project dashboard reference app template", () => {
  it("provides a Jira project dashboard runtime contract", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const serverSource = readFileSync(
      join(process.cwd(), "apps/agentic-apps/jira-project-dashboard/server.mjs"),
      "utf8",
    );

    expect(packageJson.scripts["agentic-apps:jira-project-dashboard"]).toBe(
      "node apps/agentic-apps/jira-project-dashboard/server.mjs",
    );
    expect(serverSource).toContain("url.pathname === \"/embed\"");
    expect(serverSource).toContain("/api/v1/chat/invoke");
    expect(serverSource).toContain("agent-jira-agent");
    expect(serverSource).toContain("jiraProjectInput");
    expect(serverSource).toContain('value="SRE"');
    expect(serverSource).toContain('url.searchParams.get("project") || "SRE"');
    expect(serverSource).not.toContain("fetchJiraProjectSummary");
    expect(serverSource).not.toContain("fetchJiraJson");
    expect(serverSource).not.toContain("JIRA_URL");
    expect(serverSource).not.toContain("ATLASSIAN_EMAIL");
    expect(serverSource).not.toContain("ATLASSIAN_TOKEN");
    expect(serverSource).not.toContain("/rest/api/3/search");
    expect(serverSource).toContain('source: "agent-unavailable"');
    expect(serverSource).toContain("No Jira structured output received from the CAIPE Jira agent");
    expect(serverSource).toContain("Jira project key");
    expect(serverSource).toContain("jira_project.dashboard.v1");
    expect(serverSource).toContain("submit_structured_response");
    expect(serverSource).toContain("response_format");
    expect(serverSource).toContain("ensureStructuredResponseAgent");
    expect(serverSource).toContain("hasStructuredResponseSchema");
    expect(serverSource).toContain("Enable Structured Response middleware");
    expect(serverSource).toContain("sprint-health-card");
    expect(serverSource).toContain("blocker-analysis");
    expect(serverSource).toContain("action-grid");
    expect(serverSource).toContain("action-card");
    expect(serverSource).not.toContain("hax-grid");
    expect(serverSource).not.toContain("hax-card");
    expect(serverSource).not.toContain("haxCards");
    expect(serverSource).toContain("Project Risk Cards");
    expect(serverSource).toContain("Agent Conversation");
    expect(serverSource).toContain("Jira Assistant");
    expect(serverSource).toContain("Ask Jira Assistant");
    expect(serverSource).not.toContain("HAX Project Cards");
    expect(serverSource).not.toContain("CopilotKit-Ready Conversation");
    expect(serverSource).not.toContain("Jira Copilot");
    expect(serverSource).not.toContain("Ask Jira Copilot");
    expect(serverSource).toContain("fontCustomizer");
    expect(serverSource).toContain("font-dock");
    expect(serverSource).toContain("settingsToggle");
    expect(serverSource).toContain("class=\"settings-fab\"");
    expect(serverSource).toContain("left: 18px");
    expect(serverSource).toContain("bottom: 24px");
    expect(serverSource).toContain("aria-controls=\"fontCustomizer\"");
    expect(serverSource).toContain("function toggleFontSettings");
    expect(serverSource).toContain("View settings");
    expect(serverSource).toContain("--app-font-scale: 0.8");
    expect(serverSource).toContain("font-size: calc(16px * var(--app-font-scale))");
    expect(serverSource).toContain('preferences.scale] ? preferences.scale : "small"');
    expect(serverSource).toContain("kpi-strip");
    expect(serverSource).toContain("insights-strip");
    expect(serverSource).toContain("function renderInsights");
    expect(serverSource).toContain("function kpiTile");
    expect(serverSource).toContain("function formatCount");
    expect(serverSource).toContain("bottom: 74px");
    expect(serverSource).toContain(".font-customizer select");
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
