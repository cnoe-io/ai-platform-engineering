// Tracked entity collection: list/create Issues, Decisions, and Suggestions.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getPageStore } from "@/lib/tome/page-store";
import {
  DECISIONS_DIR,
  DECISION_STATUSES,
  DECISION_TYPE,
  FM_OPENED,
  FM_OWNER,
  FM_PRIORITY,
  FM_STATUS,
  FM_TARGET,
  FM_TITLE,
  FM_TYPE,
  ISSUE_STATUSES,
  ISSUES_DIR,
  ISSUE_TYPE,
  SUGGESTIONS_DIR,
  SUGGESTION_STATUSES,
  SUGGESTION_TYPE,
  TRACKED_ENTITY_PRIORITIES,
  isTrackedEntity,
  parseFrontmatter,
  serializeFrontmatter,
  trackedEntitySlug,
} from "@/lib/tome/schema";
import {
  guardNotLocked,
  loadTomeProject,
  requireTomeEditor,
} from "@/lib/tome/tome-api";
import { parseTomeHref } from "@/lib/tome/tome-links";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };
type EntityType = typeof ISSUE_TYPE | typeof DECISION_TYPE | typeof SUGGESTION_TYPE;

const ENTITY_CONFIG = {
  [ISSUE_TYPE]: { dir: ISSUES_DIR, statuses: ISSUE_STATUSES, initial: "open" },
  [DECISION_TYPE]: { dir: DECISIONS_DIR, statuses: DECISION_STATUSES, initial: "proposed" },
  [SUGGESTION_TYPE]: {
    dir: SUGGESTIONS_DIR,
    statuses: SUGGESTION_STATUSES,
    initial: "proposed",
  },
} as const;

function entityType(value: unknown): EntityType | null {
  return value === ISSUE_TYPE || value === DECISION_TYPE || value === SUGGESTION_TYPE
    ? value
    : null;
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);
  const pages = await (await getPageStore()).listPages(projectId);
  const entities = Object.entries(pages)
    .map(([path, markdown]) => {
      const [frontmatter, body] = parseFrontmatter(markdown);
      if (!isTrackedEntity(frontmatter)) return null;
      return {
        path,
        type: String(frontmatter[FM_TYPE] ?? ""),
        title: String(frontmatter[FM_TITLE] ?? path),
        status: String(frontmatter[FM_STATUS] ?? ""),
        priority: String(frontmatter[FM_PRIORITY] ?? "medium"),
        owner: String(frontmatter[FM_OWNER] ?? "") || null,
        opened: String(frontmatter[FM_OPENED] ?? "") || null,
        target: String(frontmatter[FM_TARGET] ?? "") || null,
        body: body.trim(),
      };
    })
    .filter((entity): entity is NonNullable<typeof entity> => entity !== null);
  return successResponse({ entities });
});

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  await guardNotLocked(tctx.projectId, tctx.project.locked ?? false);
  const body = (await request.json().catch(() => null)) as {
    type?: unknown;
    title?: unknown;
    description?: unknown;
    status?: unknown;
    priority?: unknown;
    owner?: unknown;
    opened?: unknown;
    target?: unknown;
  } | null;
  const type = entityType(body?.type);
  if (!type) throw new ApiError("`type` must be issue, decision, or suggestion", 400, "BAD_REQUEST");
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 160) {
    throw new ApiError("`title` must be between 1 and 160 characters", 400, "BAD_REQUEST");
  }
  const config = ENTITY_CONFIG[type];
  if (
    body?.status !== undefined &&
    (typeof body.status !== "string" ||
      !(config.statuses as readonly string[]).includes(body.status))
  ) {
    throw new ApiError(
      `Invalid status; expected one of ${config.statuses.join(", ")}`,
      400,
      "BAD_REQUEST",
    );
  }
  const status = typeof body?.status === "string" ? body.status : config.initial;
  if (
    body?.priority !== undefined &&
    (typeof body.priority !== "string" ||
      !(TRACKED_ENTITY_PRIORITIES as readonly string[]).includes(body.priority))
  ) {
    throw new ApiError("Invalid priority", 400, "BAD_REQUEST");
  }
  const priority = typeof body?.priority === "string" ? body.priority : "medium";
  const target = typeof body?.target === "string" ? body.target.trim() : "";
  if (target && !parseTomeHref(target)) {
    throw new ApiError(
      "`target` must be a tome:// page reference, for example tome://@project/overview.md",
      400,
      "BAD_REQUEST",
    );
  }
  const path = `${config.dir}/${trackedEntitySlug(title)}.md`;
  const store = await getPageStore();
  const existing = await store.readPage(tctx.projectId, path).catch(() => null);
  if (existing !== null) {
    throw new ApiError(`A tracked entity already exists at ${path}`, 409, "ENTITY_EXISTS");
  }
  const frontmatter = {
    [FM_TYPE]: type,
    [FM_TITLE]: title,
    kind: "dynamic",
    [FM_STATUS]: status,
    [FM_PRIORITY]: priority,
    [FM_OPENED]:
      typeof body?.opened === "string" && body.opened.trim()
        ? body.opened.trim()
        : new Date().toISOString().slice(0, 10),
    ...(typeof body?.owner === "string" && body.owner.trim()
      ? { [FM_OWNER]: body.owner.trim() }
      : {}),
    ...(target ? { [FM_TARGET]: target } : {}),
  };
  const markdown = serializeFrontmatter(
    frontmatter,
    typeof body?.description === "string" ? body.description.trim() : "",
  );
  await store.writePage(tctx.projectId, path, markdown, {
    author: tctx.user.email ?? "tome",
    message: `create ${type}: ${title}`,
  });
  auditTome({
    action: "tome.entity.create",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    page: path,
    metadata: { type, status, priority, target: target || null },
  });
  return successResponse({ path, type, title, status, priority, target: target || null });
});
