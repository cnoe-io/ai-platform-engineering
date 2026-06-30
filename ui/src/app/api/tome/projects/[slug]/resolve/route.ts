// Resolve a tome:// reference for this project (#65). GET ?ref=<tome://…> →
// a discriminated resolution (glossary term / page / unknown). Glossary terms
// resolve same-project first, then org-scoped terms across projects. Backs the
// UI hover/click and the tome_resolve_ref MCP tool so they don't diverge.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { resolveRef } from "@/lib/tome/resolver";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  const result = await resolveRef(tctx.projectId, slug, ref);
  return successResponse(result);
});
