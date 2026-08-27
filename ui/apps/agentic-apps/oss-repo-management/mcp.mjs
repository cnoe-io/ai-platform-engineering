import { z } from "zod";

import { mcpJson } from "../../_lib/app-mcp-server.mjs";

export function registerOssReportCardMcpTools(
  server,
  { loadReportCard, renderMarkdown },
) {
  const inputSchema = z.object({
    repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, "Use owner/repository format"),
    staleDays: z.number().int().min(7).max(365).default(30),
    refresh: z.boolean().default(false),
  });

  server.registerTool(
    "oss_get_report_card",
    {
      title: "Get OSS repository report card",
      description:
        "Generate a source-backed OSS report card with activity, contributors, security, governance, and foundation-readiness evidence.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => mcpJson(await loadReportCard(input)),
  );

  server.registerTool(
    "oss_get_markdown_report",
    {
      title: "Generate OSS report card Markdown",
      description: "Return a Markdown report generated from the same source-backed report-card snapshot.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const dashboard = await loadReportCard(input);
      return mcpJson({
        repo: dashboard.repo,
        generatedAt: dashboard.generatedAt,
        markdown: renderMarkdown(dashboard, {
          reportOrigin: dashboard.delivery?.cache === "hit" ? "cached" : "live",
        }),
      });
    },
  );
}
