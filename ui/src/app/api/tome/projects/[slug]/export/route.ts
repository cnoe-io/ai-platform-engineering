import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { getPageStore } from "@/lib/tome/page-store";
import { buildTree } from "@/lib/tome/schema";
import { loadTomeProject } from "@/lib/tome/tome-api";
import {
  buildWikiExportDocument,
  renderWikiHtml,
  renderWikiMarkdown,
} from "@/lib/tome/wiki-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };
type ExportFormat = "pdf" | "html" | "markdown";

function exportFormat(request: NextRequest): ExportFormat {
  const format = request.nextUrl.searchParams.get("format") ?? "pdf";
  if (format === "pdf" || format === "html" || format === "markdown") return format;
  throw new ApiError("Supported export formats: pdf, html, markdown", 400, "BAD_REQUEST");
}

function safeFilename(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "wiki";
}

/** Download the complete current wiki, or one selected page, as PDF, HTML, or Markdown. */
export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const format = exportFormat(request);
  const requestedPath = request.nextUrl.searchParams.get("path")?.trim() || null;
  const tctx = await loadTomeProject(request, slug);
  const store = await getPageStore();
  const pages = await store.listPages(tctx.projectId);
  if (requestedPath && !Object.prototype.hasOwnProperty.call(pages, requestedPath)) {
    throw new ApiError("Page not found", 404, "PAGE_NOT_FOUND");
  }
  const exportPages = requestedPath
    ? { [requestedPath]: pages[requestedPath] }
    : pages;
  const document = buildWikiExportDocument({
    projectName: tctx.project.title || tctx.project.name || slug,
    pages: exportPages,
    tree: buildTree(exportPages),
  });
  const pageName = requestedPath?.replace(/\.mdx?$/i, "");
  const base = pageName
    ? `${safeFilename(slug)}-${safeFilename(pageName)}`
    : `${safeFilename(slug)}-wiki`;
  const commonHeaders = {
    "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename="${base}.${format === "markdown" ? "md" : format}"`,
    "X-Content-Type-Options": "nosniff",
  };

  if (format === "html") {
    return new Response(renderWikiHtml(document), {
      headers: { ...commonHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (format === "markdown") {
    return new Response(renderWikiMarkdown(document, { pageScoped: requestedPath !== null }), {
      headers: { ...commonHeaders, "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  const { renderWikiPdf } = await import("@/lib/tome/wiki-export-pdf");
  const pdf = await renderWikiPdf(document);
  return new Response(new Uint8Array(pdf), {
    headers: {
      ...commonHeaders,
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
    },
  });
});
