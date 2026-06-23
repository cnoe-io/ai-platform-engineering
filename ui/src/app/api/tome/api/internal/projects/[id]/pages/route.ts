// Internal agent callback: POST a page write (the agent's persist hook).
// Body = WritePageRequest { path, body, message, author, report_id? }.
// Matches agent/http_client.py write_page.

import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { requireAgentToken, resolveProject } from "@/lib/tome/internal-api";
import { getPageStore } from "@/lib/tome/page-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// All current pages as a `{ path: markdown }` map. The agent calls this at the
// start of each chat/ingest turn to rehydrate its `/project` working copy from
// the source of truth (Mongo), so it never reads stale files.
export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  requireAgentToken(request);
  const { id } = await ctx.params;
  const project = await resolveProject(id);
  const store = await getPageStore();
  const pages = await store.listPages(project._id);
  return Response.json(pages);
});

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  requireAgentToken(request);
  const { id } = await ctx.params;
  const project = await resolveProject(id);

  const body = (await request.json().catch(() => ({}))) as {
    path?: string;
    body?: string;
    message?: string;
    author?: string;
    report_id?: string | null;
  };
  if (typeof body.path !== "string" || typeof body.body !== "string") {
    throw new ApiError("`path` and `body` are required", 400, "BAD_REQUEST");
  }

  const store = await getPageStore();
  await store.writePage(project._id, body.path, body.body, {
    message: body.message || `agent wrote ${body.path}`,
    author: body.author || "tome-agent",
    reportId: body.report_id ?? undefined,
  });
  return Response.json({ ok: true });
});
