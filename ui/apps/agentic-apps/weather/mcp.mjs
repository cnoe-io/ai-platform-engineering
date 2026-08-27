import { z } from "zod";

import { mcpJson } from "../../_lib/app-mcp-server.mjs";

export function registerWeatherMcpTools(server, { fetchDashboard, buildResponse }) {
  server.registerTool(
    "weather_get_dashboard",
    {
      title: "Get live weather dashboard",
      description:
        "Return current conditions, forecast, air quality, alerts, and daily guidance from the live weather providers.",
      inputSchema: z.object({
        city: z.string().min(1).max(120).default("San Jose"),
        intent: z.enum(["forecast-summary", "outdoor-window", "air-quality", "alerts"]).default("forecast-summary"),
        question: z.string().max(500).default(""),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ city, intent, question }) =>
      mcpJson(buildResponse(await fetchDashboard(city), intent, question)),
  );
}
