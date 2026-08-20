import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { buildSnapshot } from "@/lib/tome/agent-proxy";
import { getPageStore } from "@/lib/tome/page-store";
import {
  normalizePresentationDeck,
  presentationSourceFromPage,
  PRESENTATION_SOURCE_SCOPES,
  type PresentationDeck,
  type PresentationSourceScope,
} from "@/lib/tome/presentation";
import { parseFrontmatter, SPEC_BY_PATH } from "@/lib/tome/schema";
import { loadTomeProject } from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

interface GenerateBody {
  source_scope?: unknown;
  paths?: unknown;
  prompt?: unknown;
  existing_deck?: unknown;
  revision_instruction?: unknown;
  slide_id?: unknown;
}

function parseScope(value: unknown): PresentationSourceScope {
  if (typeof value === "string" && (PRESENTATION_SOURCE_SCOPES as readonly string[]).includes(value)) {
    return value as PresentationSourceScope;
  }
  throw new ApiError("source_scope must be current, selected, or wiki", 400, "BAD_REQUEST");
}

function requestedPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((path) => typeof path !== "string")) {
    throw new ApiError("paths must be an array of wiki page paths", 400, "BAD_REQUEST");
  }
  return [...new Set(value.map((path) => path.trim()).filter(Boolean))];
}

function sseFrame(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseSseFrame(frame: string): { type: string; data: Record<string, unknown> } | null {
  let type = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const data = JSON.parse(dataLines.join("\n")) as unknown;
  return data && typeof data === "object" && !Array.isArray(data)
    ? { type, data: data as Record<string, unknown> }
    : null;
}

function normalizedGenerationStream(
  upstream: ReadableStream<Uint8Array>,
  selectedPaths: string[],
  sources: Array<{ path: string; title: string }>,
  existingDeck: PresentationDeck | undefined,
  slideId: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let failed = false;

  const handleFrame = (
    frame: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ): void => {
    if (failed || !frame.trim()) return;
    try {
      const event = parseSseFrame(frame);
      if (!event) throw new Error("Agent returned a malformed stream event");
      if (event.type !== "complete") {
        controller.enqueue(encoder.encode(sseFrame(event.type, event.data)));
        return;
      }
      let deck = normalizePresentationDeck(event.data.deck, selectedPaths);
      if (existingDeck && slideId) {
        const revisedTarget = deck.slides.find((slide) => slide.id === slideId);
        deck = {
          ...deck,
          slides: existingDeck.slides.map((slide) => (
            slide.id === slideId ? (revisedTarget ?? slide) : slide
          )),
        };
      }
      controller.enqueue(encoder.encode(sseFrame("complete", {
        deck,
        sources,
        model: typeof event.data.model === "string" ? event.data.model : null,
        model_source: typeof event.data.model_source === "string" ? event.data.model_source : null,
      })));
    } catch (error) {
      failed = true;
      controller.enqueue(encoder.encode(sseFrame("error", {
        message: `Presentation generation returned invalid content: ${error instanceof Error ? error.message : "unknown error"}`,
      })));
    }
  };

  return upstream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        handleFrame(buffer.slice(0, separator), controller);
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf("\n\n");
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      handleFrame(buffer, controller);
    },
  }));
}

/** Generate or revise a deck using only server-resolved, viewer-accessible wiki pages. */
export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const body = (await request.json().catch(() => ({}))) as GenerateBody;
  const scope = parseScope(body.source_scope);
  const paths = requestedPaths(body.paths);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) throw new ApiError("A confirmed presentation prompt is required", 400, "BAD_REQUEST");
  if (prompt.length > 100_000) throw new ApiError("Presentation prompt is too large", 413, "PROMPT_TOO_LARGE");
  if ((scope === "current" && paths.length !== 1) || (scope === "selected" && paths.length === 0)) {
    throw new ApiError("Choose the wiki pages to include", 400, "NO_SOURCES");
  }

  const store = await getPageStore();
  const pages = await store.listPages(tctx.projectId);
  const isHiddenPath = (path: string): boolean => {
    const markdown = pages[path];
    if (markdown === undefined) return false;
    const [frontmatter] = parseFrontmatter(markdown);
    return (frontmatter.kind ?? SPEC_BY_PATH.get(path)?.kind) === "hidden";
  };
  // Hidden agent-only pages are excluded regardless of scope, so an explicit
  // current/selected path can't be used to bypass the "wiki" scope's filter.
  const selectedPaths = scope === "wiki"
    ? Object.keys(pages).filter((path) => !isHiddenPath(path))
    : paths.filter((path) => !isHiddenPath(path));
  if (selectedPaths.length === 0) throw new ApiError("No wiki pages are available to present", 400, "NO_SOURCES");
  if (selectedPaths.length > 100) {
    throw new ApiError("Select at most 100 wiki pages for one presentation", 413, "TOO_MANY_SOURCES");
  }
  const missing = selectedPaths.find((path) => !Object.prototype.hasOwnProperty.call(pages, path));
  if (missing) throw new ApiError(`Wiki page not found: ${missing}`, 404, "PAGE_NOT_FOUND");

  const sources = selectedPaths.map((path) => presentationSourceFromPage(path, pages[path]));
  const sourceChars = sources.reduce((total, source) => total + source.content.length, 0);
  if (sourceChars > 500_000) {
    throw new ApiError(
      "The selected wiki content is too large for one generation run. Choose Selected pages and narrow the source set.",
      413,
      "SOURCES_TOO_LARGE",
    );
  }

  let existingDeck: PresentationDeck | undefined;
  if (body.existing_deck !== undefined && body.existing_deck !== null) {
    try {
      existingDeck = normalizePresentationDeck(body.existing_deck, selectedPaths);
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? error.message : "Invalid existing deck",
        400,
        "INVALID_DECK",
      );
    }
  }
  const revisionInstruction = typeof body.revision_instruction === "string"
    ? body.revision_instruction.trim()
    : "";
  if (existingDeck && !revisionInstruction) {
    throw new ApiError("A revision instruction is required", 400, "BAD_REQUEST");
  }

  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) {
    throw new ApiError("Tome agent is not configured (set TOME_AGENT_URL).", 503, "AGENT_NOT_CONFIGURED");
  }
  const upstream = await fetch(`${agentUrl.replace(/\/$/, "")}/presentation/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      snapshot: buildSnapshot(tctx),
      prompt,
      sources,
      ...(existingDeck ? { existing_deck: existingDeck } : {}),
      ...(revisionInstruction ? { revision_instruction: revisionInstruction } : {}),
      ...(typeof body.slide_id === "string" && body.slide_id.trim()
        ? { slide_id: body.slide_id.trim() }
        : {}),
    }),
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    const result = (await upstream.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof result?.detail === "string" ? result.detail : `Agent returned ${upstream.status}`;
    throw new ApiError(`Presentation generation failed: ${detail}`, 502, "PRESENTATION_GENERATION_FAILED");
  }
  const slideId = typeof body.slide_id === "string" ? body.slide_id.trim() : "";
  const stream = normalizedGenerationStream(
    upstream.body,
    selectedPaths,
    sources.map(({ path, title }) => ({ path, title })),
    existingDeck,
    slideId,
  );
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
