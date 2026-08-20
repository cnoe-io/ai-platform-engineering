// "Check for template drift" (#508). Synchronous, read-only: classifies
// every page against the live template config (#507) and returns the
// report. Any reader may run this (not gated to the data steward/editor):
// it makes no writes, and per-page visibility into template staleness is
// useful to anyone viewing the wiki, not just whoever can edit it.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { buildSnapshot } from "@/lib/tome/agent-proxy";
import { getPageStore } from "@/lib/tome/page-store";
import { checkTemplateDrift } from "@/lib/tome/template-drift";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);

  if (!process.env.TOME_AGENT_URL) {
    throw new ApiError(
      "Tome agent is not configured (set TOME_AGENT_URL).",
      503,
      "AGENT_NOT_CONFIGURED",
    );
  }

  const store = await getPageStore();
  const pages = await store.listPages(tctx.projectId);
  if (Object.keys(pages).length === 0) {
    throw new ApiError(
      "This wiki has no pages yet. Run an ingest first.",
      400,
      "EMPTY_WIKI",
    );
  }

  const snapshot = buildSnapshot(tctx);
  const report = await checkTemplateDrift(snapshot, pages);
  return successResponse({ pages: report });
});
