import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { buildSnapshot } from "@/lib/tome/agent-proxy";
import { getPageStore } from "@/lib/tome/page-store";
import {
  DEFAULT_PRESENTATION_REQUIREMENTS,
  normalizePresentationRequirements,
  presentationSourceFromPage,
  PRESENTATION_SOURCE_SCOPES,
  type PresentationSourceScope,
} from "@/lib/tome/presentation";
import { parseFrontmatter, SPEC_BY_PATH } from "@/lib/tome/schema";
import { loadTomeProject } from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

interface AssistBody {
  source_scope?: unknown;
  paths?: unknown;
  current_requirements?: unknown;
  instruction?: unknown;
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

/** Stream an editable presentation brief using only authorized wiki source bodies. */
export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const body = (await request.json().catch(() => ({}))) as AssistBody;
  const scope = parseScope(body.source_scope);
  const paths = requestedPaths(body.paths);
  if ((scope === "current" && paths.length !== 1) || (scope === "selected" && paths.length === 0)) {
    throw new ApiError("Choose the wiki pages AI Assist should review", 400, "NO_SOURCES");
  }

  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (instruction.length > 5_000) {
    throw new ApiError("AI Assist guidance is too large", 413, "PROMPT_TOO_LARGE");
  }
  let currentRequirements;
  try {
    currentRequirements = normalizePresentationRequirements(
      body.current_requirements ?? {},
      DEFAULT_PRESENTATION_REQUIREMENTS,
    );
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? error.message : "Invalid presentation requirements",
      400,
      "BAD_REQUEST",
    );
  }

  const store = await getPageStore();
  const pages = await store.listPages(tctx.projectId);
  const selectedPaths = scope === "wiki"
    ? Object.keys(pages).filter((path) => {
        const [frontmatter] = parseFrontmatter(pages[path]);
        return (frontmatter.kind ?? SPEC_BY_PATH.get(path)?.kind) !== "hidden";
      })
    : paths;
  if (selectedPaths.length === 0) {
    throw new ApiError("No wiki pages are available for AI Assist", 400, "NO_SOURCES");
  }
  if (selectedPaths.length > 100) {
    throw new ApiError("Select at most 100 wiki pages for AI Assist", 413, "TOO_MANY_SOURCES");
  }
  const missing = selectedPaths.find((path) => !Object.prototype.hasOwnProperty.call(pages, path));
  if (missing) throw new ApiError(`Wiki page not found: ${missing}`, 404, "PAGE_NOT_FOUND");

  const sources = selectedPaths.map((path) => presentationSourceFromPage(path, pages[path]));
  const sourceChars = sources.reduce((total, source) => total + source.content.length, 0);
  if (sourceChars > 500_000) {
    throw new ApiError(
      "The selected wiki content is too large for AI Assist. Choose Selected pages and narrow the source set.",
      413,
      "SOURCES_TOO_LARGE",
    );
  }

  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) {
    throw new ApiError("Tome agent is not configured (set TOME_AGENT_URL).", 503, "AGENT_NOT_CONFIGURED");
  }
  const upstream = await fetch(`${agentUrl.replace(/\/$/, "")}/presentation/requirements/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      snapshot: buildSnapshot(tctx),
      sources,
      current_requirements: {
        goal: currentRequirements.goal,
        key_message: currentRequirements.keyMessage,
        audience: currentRequirements.audience,
        slide_count: currentRequirements.slideCount,
        duration_minutes: currentRequirements.durationMinutes,
        tone: currentRequirements.tone,
        technical_detail: currentRequirements.technicalDetail,
        required_sections: currentRequirements.requiredSections,
        excluded_topics: currentRequirements.excludedTopics,
        visual_preferences: currentRequirements.visualPreferences,
        include_speaker_notes: currentRequirements.includeSpeakerNotes,
      },
      instruction,
    }),
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    const result = (await upstream.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof result?.detail === "string" ? result.detail : `Agent returned ${upstream.status}`;
    throw new ApiError(`AI Assist failed: ${detail}`, 502, "PRESENTATION_ASSIST_FAILED");
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
