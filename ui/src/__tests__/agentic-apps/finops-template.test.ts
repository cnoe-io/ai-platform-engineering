/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("finops reference app template", () => {
  it("provides an integrated real-data AWS agent runtime contract", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const serverSource = readFileSync(
      join(process.cwd(), "apps/agentic-apps/finops/server.mjs"),
      "utf8",
    );

    expect(packageJson.scripts["agentic-apps:finops"]).toBe(
      "node apps/agentic-apps/finops/server.mjs",
    );
    expect(serverSource).toContain("url.pathname === \"/embed\"");
    expect(serverSource).toContain("/api/summary");
    expect(serverSource).toContain("/api/v1/chat/stream/start");
    expect(serverSource).toContain("AWS Cost Explorer");
    expect(serverSource).toContain("\"agent-aws-cost-explorer\"");
    expect(serverSource).toContain("dashboardKind");
    expect(serverSource).toContain("rawCost");
    expect(serverSource).toContain("trend: [{ date");
    expect(serverSource).toContain("response_format");
    expect(serverSource).toContain("finops.dashboard.v1");
    expect(serverSource).toContain("structured_output");
    expect(serverSource).toContain("Structured output received from stream.");
    expect(serverSource).toContain("No finops.dashboard.v1 structured output received");
    expect(serverSource).not.toContain("parseCostExplorerPayload(content)");
    expect(serverSource).toContain("handleStreamEvent");
    expect(serverSource).toContain("appendActivityEvent");
    expect(serverSource).toContain("appendStreamContent");
    expect(serverSource).toContain("renderMarkdownReport");
    expect(serverSource).toContain("markdown-report");
    expect(serverSource).toContain("fontCustomizer");
    expect(serverSource).toContain("font-dock");
    expect(serverSource).toContain("settingsToggle");
    expect(serverSource).toContain("class=\"settings-fab\"");
    expect(serverSource).toContain("left: 18px");
    expect(serverSource).toContain("bottom: 24px");
    expect(serverSource).toContain("aria-controls=\"fontCustomizer\"");
    expect(serverSource).toContain("function toggleFontSettings");
    expect(serverSource).toContain("View settings");
    expect(serverSource).toContain("fontFamilySelect");
    expect(serverSource).toContain("fontScaleSelect");
    expect(serverSource).toContain("applyFontPreferences");
    expect(serverSource).toContain("agentic-app.fontPreferences");
    expect(serverSource).toContain("--app-font-scale: 0.8");
    expect(serverSource).toContain("kpi-strip");
    expect(serverSource).toContain("insights-strip");
    expect(serverSource).toContain("renderSparkline");
    expect(serverSource).toContain('preferences.scale] ? preferences.scale : "small"');
    expect(serverSource.indexOf('class="font-customizer font-dock"')).toBeGreaterThan(
      serverSource.indexOf("</section>"),
    );
    expect(serverSource).toContain("activity-spinner");
    expect(serverSource).toContain("runStatus");
    expect(serverSource).toContain("dashboardStatus");
    expect(serverSource).toContain("activityFooter");
    expect(serverSource).toContain("debugProgress");
    expect(serverSource).toContain("isDebugTool");
    expect(serverSource).toContain("setDashboardStatus");
    expect(serverSource).toContain("setRunButtonBusy");
    expect(serverSource).toContain("setRunStatus");
    expect(serverSource).toContain("Use aws_cli_execute exactly once");
    expect(serverSource).toContain("profile must be an empty string");
    expect(serverSource).toContain("Raw Cost Explorer rows");
    expect(serverSource).toContain("renderTrendChart");
    expect(serverSource).toContain("/api/agentic-apps/finops-cache");
    expect(serverSource).toContain("loadCachedDashboard");
    expect(serverSource).toContain("runHistory");
    expect(serverSource).toContain("renderRunHistory");
    expect(serverSource).toContain("agentProgress");
    expect(serverSource).toContain("selectService");
    expect(serverSource).toContain("selectTrendDate");
    expect(serverSource).toContain("openAssistantChat");
    expect(serverSource).toContain("caipe.agenticApp.assistant.open.v1");
    expect(serverSource).not.toContain("No mock data");
    expect(serverSource).not.toContain("CAIPE Assistant Overlay");
    expect(serverSource).toContain("caipe.agenticApp.context.v1");
  });
});
