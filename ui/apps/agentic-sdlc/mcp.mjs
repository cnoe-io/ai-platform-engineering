import { z } from "zod";

import { mcpJson } from "../_lib/app-mcp-server.mjs";

export function registerAgenticSdlcMcpTools(server, { getRepositorySnapshot, getRuntimeContract }) {
  server.registerTool(
    "sdlc_get_repository_snapshot",
    {
      title: "Get repository SDLC snapshot",
      description:
        "Return a bounded source-backed snapshot of repository metadata, open pull requests, issues, and workflow status.",
      inputSchema: z.object({
        repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, "Use owner/repository format"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ repo }) => mcpJson(await getRepositorySnapshot(repo)),
  );

  server.registerTool(
    "sdlc_get_runtime_contract",
    {
      title: "Get Agentic SDLC runtime contract",
      description: "Return the supported SDLC integration, webhook, and authorization capabilities.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => mcpJson(getRuntimeContract()),
  );
}
