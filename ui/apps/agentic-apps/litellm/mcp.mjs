import { z } from "zod";

import { mcpJson } from "../../_lib/app-mcp-server.mjs";

export function registerLiteLlmMcpTools(server, { getDailyActivity, getModelInfo }) {
  server.registerTool(
    "litellm_get_daily_activity",
    {
      title: "Get LiteLLM daily activity",
      description: "Return bounded daily LiteLLM spend, token, request, user, and model activity.",
      inputSchema: z.object({
        startDate: z.string().date(),
        endDate: z.string().date(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => mcpJson(await getDailyActivity(input)),
  );

  server.registerTool(
    "litellm_get_model_info",
    {
      title: "Get LiteLLM model inventory",
      description: "Return the configured LiteLLM models and their safe operational metadata.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => mcpJson(await getModelInfo()),
  );
}
