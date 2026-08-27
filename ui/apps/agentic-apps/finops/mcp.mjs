import { z } from "zod";

import { mcpJson } from "../../_lib/app-mcp-server.mjs";

export function registerFinOpsMcpTools(server, { getCapabilities, getLiteLlmDashboard }) {
  server.registerTool(
    "finops_get_capabilities",
    {
      title: "Get FinOps data-source capabilities",
      description:
        "Return the configured FinOps data sources, supported reporting windows, and exact agent/runtime readiness.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => mcpJson(getCapabilities()),
  );

  server.registerTool(
    "finops_get_litellm_dashboard",
    {
      title: "Get LiteLLM cost dashboard",
      description: "Return source-backed LiteLLM spend, token, request, user, and model-mix analysis.",
      inputSchema: z.object({
        lookbackDays: z.number().int().min(1).max(120).default(30),
        dashboardKind: z
          .enum(["llm-usage-by-user", "model-mix", "spend-overview", "optimization"])
          .default("spend-overview"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => mcpJson(await getLiteLlmDashboard(input)),
  );
}
