/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BUILTIN_AGENTIC_APP_PACKAGE_SEEDS } from "@/lib/agentic-apps/builtin-packages";

describe("weather reference app template", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  it("ships Weather as a built-in Open-Meteo agent package seed", () => {
    const weather = BUILTIN_AGENTIC_APP_PACKAGE_SEEDS.find(
      (pkg) => pkg.packageId === "weather",
    );

    expect(weather).toEqual(
      expect.objectContaining({
        packageId: "weather",
        source: "builtin",
        catalog: expect.objectContaining({
          categories: expect.arrayContaining(["reference", "weather"]),
          capabilities: expect.arrayContaining(["open-meteo", "embedded-agent"]),
        }),
      }),
    );
    expect(weather?.manifest).toEqual(
      expect.objectContaining({
        id: "weather",
        displayName: "Weather Lab",
        runtime: expect.objectContaining({
          kind: "proxied-next-zone",
          mountPath: "/apps/weather",
          chrome: "iframe",
        }),
        access: expect.objectContaining({
          tokenScopes: expect.arrayContaining(["weather:read", "weather:agent", "agents:invoke"]),
          canUseCustomAgents: true,
        }),
      }),
    );
  });

  it("supports Weather in the local env registry for quick host demos", async () => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    process.env.AGENTIC_APPS_ENABLED = "weather";
    process.env.AGENTIC_APP_WEATHER_ORIGIN = "http://localhost:3020";

    const { getAgenticAppById } = await import("@/lib/agentic-apps/registry");

    expect(getAgenticAppById("weather")).toEqual(
      expect.objectContaining({
        id: "weather",
        runtime: expect.objectContaining({
          origin: "http://localhost:3020",
          mountPath: "/apps/weather",
        }),
      }),
    );
  });

  it("provides an agent-structured Weather runtime script", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const serverSource = readFileSync(
      join(process.cwd(), "apps/agentic-apps/weather/server.mjs"),
      "utf8",
    );

    expect(packageJson.scripts["agentic-apps:weather"]).toBe(
      "node apps/agentic-apps/weather/server.mjs",
    );
    expect(serverSource).toContain("url.pathname === \"/embed\"");
    expect(serverSource).toContain("/api/ag-ui/weather-layout");
    expect(serverSource).toContain("/api/copilotkit/weather-agent");
    expect(serverSource).toContain("/api/v1/chat/stream/start");
    expect(serverSource).toContain("WEATHER_AGENT_ID");
    expect(serverSource).toContain("agent_id: agentId");
    expect(serverSource).toContain("useCopilotAction");
    expect(serverSource).not.toContain("geocoding-api.open-meteo.com");
    expect(serverSource).not.toContain("api.open-meteo.com");
    expect(serverSource).not.toContain("air-quality-api.open-meteo.com");
    expect(serverSource).not.toContain("api.weather.gov");
    expect(serverSource).toContain('source: "agent-unavailable"');
    expect(serverSource).toContain("No Weather structured output received from the CAIPE Weather agent");
    expect(serverSource).toContain("nationalWeatherAlerts");
    expect(serverSource).toContain("dailyGuidance");
    expect(serverSource).toContain("howIsMyDay");
    expect(serverSource).toContain("aqiPanel");
    expect(serverSource).toContain("alertRows");
    expect(serverSource).toContain("dashboardStatus");
    expect(serverSource).toContain("unitToggle");
    expect(serverSource).toContain('unit: "fahrenheit"');
    expect(serverSource).toContain("function cToF");
    expect(serverSource).toContain("formatTemperature");
    expect(serverSource).toContain("questionInput");
    expect(serverSource).toContain("weather-question-input");
    expect(serverSource).toContain("fontCustomizer");
    expect(serverSource).toContain("font-dock");
    expect(serverSource).toContain("View settings");
    expect(serverSource).toContain("fontFamilySelect");
    expect(serverSource).toContain("fontScaleSelect");
    expect(serverSource).toContain("applyFontPreferences");
    expect(serverSource).toContain("agentic-app.fontPreferences");
    expect(serverSource).toContain("extractCityFromQuestion");
    expect(serverSource).toContain("snow-conditions");
    expect(serverSource).toContain("What are the snow conditions in Denver?");
    expect(serverSource).toContain("buildWeatherDashboardResponseFormat");
    expect(serverSource).toContain("weather.dashboard.v1");
    expect(serverSource).toContain("submit_structured_response");
    expect(serverSource).toContain("response_format");
    expect(serverSource).toContain("weather-icon");
    expect(serverSource).toContain("forecast-temps");
    expect(serverSource).toContain("forecast-meta");
    expect(serverSource).toContain("weatherCodeToIcon");
    expect(serverSource).toContain("Weather Lab • Open-Meteo • Embedded Agent");
    expect(serverSource).toContain("Weather Intelligence");
    expect(serverSource).toContain("embedded weather panel");
    expect(serverSource).not.toContain("Weather Lab • Open-Meteo • Embedded Copilot");
    expect(serverSource).not.toContain("CopilotKit Embedded");
    expect(serverSource).not.toContain("CopilotKit-style");
    expect(serverSource).toContain("function appUrl");
    expect(serverSource).not.toContain('fetch(appUrl("/api/weather?city="');
    expect(serverSource).toContain('fetch(appUrl("/api/copilotkit/weather-agent"');
    expect(serverSource).toContain("activityFooter");
    expect(serverSource).toContain("runStatus");
    expect(serverSource).toContain("activitySummary");
    expect(serverSource).toContain("agentProgress");
    expect(serverSource).toContain("streamedContent");
    expect(serverSource).toContain("consumeAgentStream");
    expect(serverSource).toContain("handleStreamEvent");
    expect(serverSource).toContain("appendActivityEvent");
    expect(serverSource).toContain("appendStreamContent");
    expect(serverSource).toContain("openAssistantChat");
    expect(serverSource).toContain("caipe.agenticApp.assistant.open.v1");
    expect(serverSource).toContain("caipe.agenticApp.context.v1");
  });
});
