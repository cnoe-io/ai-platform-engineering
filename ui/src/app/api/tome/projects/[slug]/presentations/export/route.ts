import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { getPageStore } from "@/lib/tome/page-store";
import { normalizePresentationDeck } from "@/lib/tome/presentation";
import { presentationHtmlFilename, renderPresentationHtml } from "@/lib/tome/presentation-html";
import { presentationFilename, renderPresentationPptx } from "@/lib/tome/presentation-pptx";
import { presentationPublicOrigin } from "@/lib/tome/public-origin";
import { loadTomeProject } from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

/** Export the reviewed deck as self-contained HTML or editable OOXML after re-checking access. */
export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const body = (await request.json().catch(() => ({}))) as { deck?: unknown; format?: unknown };
  const format = body.format === undefined ? "pptx" : body.format;
  if (format !== "pptx" && format !== "html") {
    throw new ApiError("format must be pptx or html", 400, "INVALID_FORMAT");
  }
  const store = await getPageStore();
  const pages = await store.listPages(tctx.projectId);
  let deck;
  try {
    deck = normalizePresentationDeck(body.deck, Object.keys(pages));
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? error.message : "Invalid presentation deck",
      400,
      "INVALID_DECK",
    );
  }
  const projectName = tctx.project.title || tctx.project.name || slug;
  const sourceBaseUrl = new URL(
    `/projects/${encodeURIComponent(slug)}/tome/wiki/`,
    presentationPublicOrigin(request),
  ).toString();
  if (format === "html") {
    const html = renderPresentationHtml({ deck, projectName, sourceBaseUrl });
    return new Response(html, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${presentationHtmlFilename(slug, deck.title)}"`,
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const bytes = await renderPresentationPptx({ deck, projectName, sourceBaseUrl });
  const bodyBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(bodyBytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${presentationFilename(slug, deck.title)}"`,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
