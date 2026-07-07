// Tome single-page CRUD — nested under a CAIPE project slug.
//
//   GET    /api/tome/projects/[slug]/pages/[...path]  → one page
//   PUT    /api/tome/projects/[slug]/pages/[...path]  → write (editor)
//   DELETE /api/tome/projects/[slug]/pages/[...path]  → tombstone (editor)
//
// `[...path]` is the page path under the project, e.g. `charter.md` or
// `repos/mycelium/overview.md`.

import { NextRequest } from "next/server";

import {
  ApiError,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getPageStore } from "@/lib/tome/page-store";
import { PageNotFoundError } from "@/lib/tome/mongo-page-store";
import { parseFrontmatter } from "@/lib/tome/schema";
import { SPEC_BY_PATH } from "@/lib/tome/schema";
import type { PageKind, PageResponse } from "@/types/tome";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

function pagePathFrom(parts: string[]): string {
  // Next has already URL-decoded each segment; rejoin to the stored path.
  return parts.join("/");
}

function toResponse(path: string, markdown: string): PageResponse {
  const [fm] = parseFrontmatter(markdown);
  const spec = SPEC_BY_PATH.get(path);
  const title = String(fm.title ?? spec?.title ?? path);
  const kind = (typeof fm.kind === "string" ? fm.kind : spec?.kind ?? "stable") as PageKind;
  return { path, markdown, title, kind };
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, path } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);
  const pagePath = pagePathFrom(path);

  const store = await getPageStore();
  try {
    const markdown = await store.readPage(projectId, pagePath);
    return successResponse(toResponse(pagePath, markdown));
  } catch (err) {
    if (err instanceof PageNotFoundError) {
      throw new ApiError("Page not found", 404, "PAGE_NOT_FOUND");
    }
    throw err;
  }
});

export const PUT = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, path } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  if (tctx.project.locked) {
    throw new ApiError(
      "An ingest is in progress — the wiki is read-only until it finishes.",
      409,
      "PROJECT_LOCKED",
    );
  }
  const pagePath = pagePathFrom(path);

  const body = (await request.json().catch(() => ({}))) as {
    markdown?: string;
    message?: string;
  };
  if (typeof body.markdown !== "string") {
    throw new ApiError("`markdown` (string) is required", 400, "BAD_REQUEST");
  }

  const store = await getPageStore();
  await store.writePage(tctx.projectId, pagePath, body.markdown, {
    message: body.message || `edit ${pagePath}`,
    author: tctx.user.email ?? "tome",
  });

  auditTome({
    action: "tome.page.edit",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    page: pagePath,
  });

  return successResponse(toResponse(pagePath, body.markdown));
});

export const DELETE = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, path } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  if (tctx.project.locked) {
    throw new ApiError(
      "An ingest is in progress — the wiki is read-only until it finishes.",
      409,
      "PROJECT_LOCKED",
    );
  }
  const pagePath = pagePathFrom(path);

  const store = await getPageStore();
  await store.deletePage(tctx.projectId, pagePath, {
    author: tctx.user.email ?? "tome",
  });

  auditTome({
    action: "tome.page.delete",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    page: pagePath,
  });

  return successResponse({ deleted: true, path: pagePath });
});
