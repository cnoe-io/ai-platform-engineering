// Internal agent callback: POST { paths } → { path: markdown } for stable pages.
// Matches agent/http_client.py fetch_stable_pages.

import { NextRequest } from "next/server";

import { withErrorHandler } from "@/lib/api-middleware";
import { requireAgentToken, resolveProject } from "@/lib/tome/internal-api";
import { getPageStore } from "@/lib/tome/page-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  requireAgentToken(request);
  const { id } = await ctx.params;
  const project = await resolveProject(id);
  const body = (await request.json().catch(() => ({}))) as { paths?: string[] };
  const paths = Array.isArray(body.paths) ? body.paths : [];
  if (paths.length === 0) return Response.json({});

  const store = await getPageStore();
  const pages = await store.listPages(project._id);
  const out: Record<string, string> = {};
  for (const p of paths) if (pages[p] !== undefined) out[p] = pages[p];
  // Plain map response (agent reads resp.json() directly).
  return Response.json(out);
});
