// "Resolve template drift" (#487/#508): acts only on the most recent Check
// report the client sends up — never re-derives its own view of drift.
//
// Split by finding type:
// - version_behind, confirmed not drifted -> bump `template_version` on the
//   page directly (metadata only, no LLM, no ingest run). Deterministic,
//   same as the binding stamp itself: this is a code decision, not a
//   content edit.
// - missing / version_behind (drifted, or content unchecked) -> a quick,
//   scoped ingest seeded with exactly what's wrong and how to fix it. The
//   agent still owns content; it never touches template_* frontmatter
//   (the ingest loop's own deterministic reconcile does that after the
//   turn, same as every other ingest run).

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { startIngestRun, IngestInProgressError } from "@/lib/tome/ingest-runner";
import { getPageStore } from "@/lib/tome/page-store";
import { getAllPageTemplates, type TemplateScope } from "@/lib/tome/page-templates-store";
import {
  FM_TEMPLATE_VERSION,
  parseFrontmatter,
  serializeFrontmatter,
} from "@/lib/tome/schema";
import type { PageDrift } from "@/lib/tome/template-drift";
import { isSynthesizedType } from "@/types/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  const body = (await request.json().catch(() => ({}))) as { report?: PageDrift[] };
  const report = Array.isArray(body.report) ? body.report : [];
  if (report.length === 0) {
    throw new ApiError("No drift report given. Run \"Check for drift\" first.", 400, "BAD_REQUEST");
  }

  // Version and content drift are different axes: a page can be up to date
  // (version_behind: false) and still have drifted content (a hand edit, a
  // partial rewrite) — that case needs an ingest just like a stale-version
  // drifted page does. Only a version-behind page CONFIRMED not drifted is
  // metadata-only; an up-to-date page never needs a version bump.
  const behindNotDrifted = report.filter(
    (p) => p.status === "version_behind" && p.drifted === false,
  );
  const needsIngest = report.filter(
    (p) =>
      p.status === "missing" ||
      (p.status === "version_behind" && p.drifted !== false) ||
      (p.status === "current" && p.drifted === true),
  );

  // Metadata-only version bump — no content change, no agent involved.
  let versionBumped: string[] = [];
  if (behindNotDrifted.length > 0) {
    const store = await getPageStore();
    const pages = await store.listPages(tctx.projectId);
    const templates = await getAllPageTemplates();
    const versionByScope = new Map(templates.map((t) => [t.scope, t.version]));
    const toWrite: Record<string, string> = {};
    for (const p of behindNotDrifted) {
      const markdown = pages[p.path];
      const liveVersion = p.template_scope
        ? versionByScope.get(p.template_scope as TemplateScope)
        : undefined;
      if (markdown === undefined || liveVersion === undefined) continue;
      const [fm, pageBody] = parseFrontmatter(markdown);
      fm[FM_TEMPLATE_VERSION] = liveVersion;
      toWrite[p.path] = serializeFrontmatter(fm, pageBody);
    }
    versionBumped = Object.keys(toWrite);
    if (versionBumped.length > 0) {
      await store.writePages(tctx.projectId, toWrite, {
        message: "resolve template drift: bump template_version (metadata only, content confirmed current)",
        author: tctx.user.email || "tome-ui",
      });
    }
  }

  if (needsIngest.length === 0) {
    auditTome({
      action: "tome.template_drift.resolve",
      actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
      projectSlug: slug,
      metadata: { versionBumped: versionBumped.length, ingestStarted: false },
    });
    return successResponse({ runId: null, versionBumped });
  }

  const seedLines = ["Resolve the following template drift findings:"];
  for (const p of needsIngest) {
    if (p.status === "missing") {
      seedLines.push(
        `- MISSING: \`${p.path}\` (${p.title || p.template_path}) is in the page template but doesn't exist yet. Create it from the template's current seed guidance (use get_page_templates).`,
      );
    } else if (p.drifted === true) {
      seedLines.push(
        `- DRIFTED: \`${p.path}\`: ${p.reason || "no longer satisfies the template's current guidance"}. Rewrite it to satisfy the template's current guidance.`,
      );
    } else {
      seedLines.push(
        `- UNCHECKED: \`${p.path}\` is behind the template version; its content wasn't verified against the current guidance. Compare it to the template and rewrite only if it's actually out of date.`,
      );
    }
  }
  seedLines.push(
    "Do not add or edit `template_scope`/`template_path`/`template_version` frontmatter yourself; that's handled automatically after this run.",
  );

  try {
    const { runId } = await startIngestRun(tctx, {
      seed: seedLines.join("\n"),
      mode: "quick",
      agentEndpoint: isSynthesizedType(tctx.project.type) ? "/synthesize" : "/ingest",
    });
    auditTome({
      action: "tome.template_drift.resolve",
      actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
      projectSlug: slug,
      metadata: { versionBumped: versionBumped.length, ingestStarted: true, run_id: runId },
    });
    return successResponse({ runId, versionBumped });
  } catch (e) {
    if (e instanceof IngestInProgressError) {
      throw new ApiError(e.message, 409, "INGEST_IN_PROGRESS");
    }
    throw e;
  }
});
