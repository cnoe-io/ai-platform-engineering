// PATCH a tracked entity's lifecycle fields without replacing its prose body.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getPageStore } from "@/lib/tome/page-store";
import {
  DECISIONS_DIR,
  DECISION_STATUSES,
  DECISION_TYPE,
  FM_CLOSED,
  FM_OWNER,
  FM_PRIORITY,
  FM_STATUS,
  FM_TARGET,
  FM_TYPE,
  ISSUE_STATUSES,
  ISSUES_DIR,
  ISSUE_TYPE,
  SUGGESTIONS_DIR,
  SUGGESTION_STATUSES,
  SUGGESTION_TYPE,
  TRACKED_ENTITY_PRIORITIES,
  parseFrontmatter,
  serializeFrontmatter,
} from "@/lib/tome/schema";
import {
  guardNotLocked,
  loadTomeProject,
  requireTomeEditor,
} from "@/lib/tome/tome-api";
import { parseTomeHref } from "@/lib/tome/tome-links";

export const dynamic = "force-dynamic";

type Ctx = {
  params: Promise<{ slug: string; entityType: string; entitySlug: string }>;
};

const ENTITY_CONFIG = {
  [ISSUE_TYPE]: { dir: ISSUES_DIR, statuses: ISSUE_STATUSES },
  [DECISION_TYPE]: { dir: DECISIONS_DIR, statuses: DECISION_STATUSES },
  [SUGGESTION_TYPE]: { dir: SUGGESTIONS_DIR, statuses: SUGGESTION_STATUSES },
} as const;

export const PATCH = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, entityType, entitySlug } = await ctx.params;
  const config = ENTITY_CONFIG[entityType as keyof typeof ENTITY_CONFIG];
  if (!config) throw new ApiError("Unknown tracked entity type", 400, "BAD_REQUEST");
  if (!/^[a-z0-9][a-z0-9-]{0,159}$/i.test(entitySlug)) {
    throw new ApiError("Invalid tracked entity slug", 400, "BAD_REQUEST");
  }
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  await guardNotLocked(tctx.projectId, tctx.project.locked ?? false);
  const path = `${config.dir}/${entitySlug}.md`;
  const store = await getPageStore();
  const markdown = await store.readPage(tctx.projectId, path).catch(() => null);
  if (markdown === null) throw new ApiError("Tracked entity not found", 404, "ENTITY_NOT_FOUND");
  const [frontmatter, prose] = parseFrontmatter(markdown);
  if (String(frontmatter[FM_TYPE] ?? "") !== entityType) {
    throw new ApiError("Tracked entity type does not match its path", 409, "ENTITY_TYPE_MISMATCH");
  }
  const body = (await request.json().catch(() => null)) as {
    status?: unknown;
    priority?: unknown;
    owner?: unknown;
    target?: unknown;
  } | null;
  if (!body) throw new ApiError("Request body must be JSON", 400, "BAD_REQUEST");
  if (
    body.status === undefined &&
    body.priority === undefined &&
    body.owner === undefined &&
    body.target === undefined
  ) {
    throw new ApiError(
      "Provide at least one of status, priority, owner, or target",
      400,
      "BAD_REQUEST",
    );
  }
  const next = { ...frontmatter };
  if (body.status !== undefined) {
    if (
      typeof body.status !== "string" ||
      !(config.statuses as readonly string[]).includes(body.status)
    ) {
      throw new ApiError(
        `Invalid status; expected one of ${config.statuses.join(", ")}`,
        400,
        "BAD_REQUEST",
      );
    }
    next[FM_STATUS] = body.status;
    const terminal =
      body.status === "resolved" || body.status === "accepted" || body.status === "rejected";
    next[FM_CLOSED] = terminal ? new Date().toISOString().slice(0, 10) : "";
  }
  if (body.priority !== undefined) {
    if (
      typeof body.priority !== "string" ||
      !(TRACKED_ENTITY_PRIORITIES as readonly string[]).includes(body.priority)
    ) {
      throw new ApiError("Invalid priority", 400, "BAD_REQUEST");
    }
    next[FM_PRIORITY] = body.priority;
  }
  if (body.owner !== undefined) {
    if (typeof body.owner !== "string") throw new ApiError("Invalid owner", 400, "BAD_REQUEST");
    next[FM_OWNER] = body.owner.trim();
  }
  if (body.target !== undefined) {
    if (typeof body.target !== "string") throw new ApiError("Invalid target", 400, "BAD_REQUEST");
    const target = body.target.trim();
    if (target && !parseTomeHref(target)) {
      throw new ApiError("Target must be a tome:// page reference", 400, "BAD_REQUEST");
    }
    next[FM_TARGET] = target;
  }
  const updatedMarkdown = serializeFrontmatter(next, prose);
  await store.writePage(tctx.projectId, path, updatedMarkdown, {
    author: tctx.user.email ?? "tome",
    message: `update ${entityType} lifecycle`,
  });
  auditTome({
    action: "tome.entity.update",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    page: path,
    metadata: {
      type: entityType,
      status: String(next[FM_STATUS] ?? ""),
      priority: String(next[FM_PRIORITY] ?? ""),
    },
  });
  return successResponse({
    path,
    type: entityType,
    status: String(next[FM_STATUS] ?? ""),
    priority: String(next[FM_PRIORITY] ?? ""),
  });
});
