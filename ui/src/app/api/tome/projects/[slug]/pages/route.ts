// Tome page collection routes — nested under a CAIPE project slug.
//
//   GET  /api/tome/projects/[slug]/pages  → sidebar tree + raw pages map
//   POST /api/tome/projects/[slug]/pages  → seed greenfield wiki (idempotent)
//
// Bodies are read/written through the active PageStore; Mongo holds the index.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import {
  ensureTomeTile,
  loadTomeProject,
  requireTomeEditor,
} from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getPageStore } from "@/lib/tome/page-store";
import { buildTree } from "@/lib/tome/schema";
import { seedGreenfieldIfEmpty } from "@/lib/tome/seed";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);

  const store = await getPageStore();
  const pages = await store.listPages(projectId);
  const tree = buildTree(pages);

  return successResponse({ slug, tree, pages });
});

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  const seeded = await seedGreenfieldIfEmpty(
    tctx.projectId,
    tctx.project.description ?? "",
    tctx.user.email ?? "tome-seed",
  );

  // Surface the wiki as an Apps tile on the project page (idempotent).
  await ensureTomeTile(slug);

  // Only audit when the seed actually created pages (the op is idempotent).
  if (seeded) {
    auditTome({
      action: "tome.page.seed",
      actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
      projectSlug: slug,
      metadata: { pages_created: seeded },
    });
  }

  return successResponse({ slug, seeded });
});
