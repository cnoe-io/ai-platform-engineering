/**
 * GET /api/agentic-sdlc/repos/{owner}/{repo}/event-feed
 *
 * Curated repo event feed for operators. This intentionally returns
 * display-ready summaries and never exposes raw webhook payload JSON.
 */

import {
  getAgenticSdlcEventsCollection,
  getAgenticSdlcReposCollection,
} from "@/lib/agentic-sdlc/mongo-collections";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import type { ActorKind, AgenticSdlcEvent, ArtifactKind } from "@/types/agentic-sdlc";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 500] as const;
const DEFAULT_LIMIT = 10;
const MAX_SCAN_LIMIT = 2500;
const INTERESTING_ARTIFACT_KINDS: ArtifactKind[] = [
  "epic",
  "subtask",
  "pull_request",
  "deploy",
  "comment",
  "review",
];
const INTERESTING_EVENT_TYPES = [
  "check_run",
  "check_suite",
  "deployment_status",
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "sub_issues",
];

type FeedCategory =
  | "attention"
  | "check"
  | "deploy"
  | "issue"
  | "pull_request"
  | "review"
  | "sync";

type FeedTone = "agent" | "attention" | "default" | "failed" | "human" | "success";

interface RepoEventFeedItem {
  id: string;
  category: FeedCategory;
  tone: FeedTone;
  title: string;
  description: string;
  actor_label: string;
  actor_kind: ActorKind;
  artifact_label: string;
  occurred_at: string;
  duplicate_count: number;
  details: RepoEventFeedDetails;
}

interface RepoEventFeedDetails {
  source: AgenticSdlcEvent["source"];
  github_event_type: string | null;
  github_action: string | null;
  artifact_kind: ArtifactKind;
  artifact_id: string;
  epic_id: string | null;
  projection_status: AgenticSdlcEvent["projection_status"];
  delivered_at: string;
}

function parseLimit(url: URL): number {
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  if (!Number.isFinite(raw)) return DEFAULT_LIMIT;
  return PAGE_SIZE_OPTIONS.includes(raw as (typeof PAGE_SIZE_OPTIONS)[number])
    ? raw
    : DEFAULT_LIMIT;
}

function parsePage(url: URL): number {
  const raw = Number.parseInt(url.searchParams.get("page") ?? "", 10);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(raw, 1);
}

function isInteresting(ev: AgenticSdlcEvent): boolean {
  if (ev.projection_status === "failed") return true;
  if (ev.source === "ui") return true;
  if (INTERESTING_ARTIFACT_KINDS.includes(ev.artifact_kind)) return true;
  return Boolean(
    ev.github_event_type && INTERESTING_EVENT_TYPES.includes(ev.github_event_type),
  );
}

function toFeedItem(ev: AgenticSdlcEvent, duplicateCount = 1): RepoEventFeedItem | null {
  if (!isInteresting(ev)) return null;
  const category = eventCategory(ev);
  const action = actionLabel(ev.github_action);
  const title = eventTitle(ev, action);
  const artifactLabel = artifactLabelFor(ev);
  return {
    id: ev.github_delivery_id ?? `${ev.artifact_id}:${ev.occurred_at.toISOString()}`,
    category,
    tone: eventTone(ev, category),
    title,
    description: artifactLabel,
    actor_label: ev.actor_login ?? (ev.actor_kind === "agent" ? "agent" : "system"),
    actor_kind: ev.actor_kind,
    artifact_label: artifactLabel,
    occurred_at: ev.occurred_at.toISOString(),
    duplicate_count: duplicateCount,
    details: {
      source: ev.source,
      github_event_type: ev.github_event_type,
      github_action: ev.github_action,
      artifact_kind: ev.artifact_kind,
      artifact_id: ev.artifact_id,
      epic_id: ev.epic_id,
      projection_status: ev.projection_status,
      delivered_at: ev.delivered_at.toISOString(),
    },
  };
}

function dedupeEvents(rows: AgenticSdlcEvent[]): Array<{
  event: AgenticSdlcEvent;
  count: number;
}> {
  const grouped = new Map<string, { event: AgenticSdlcEvent; count: number }>();
  for (const row of rows) {
    if (!isInteresting(row)) continue;
    const key = [
      row.source,
      row.github_event_type ?? "",
      row.github_action ?? "",
      row.artifact_kind,
      row.artifact_id,
      row.epic_id ?? "",
      row.projection_status,
    ].join("|");
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, { event: row, count: 1 });
    }
  }
  return Array.from(grouped.values());
}

function eventCategory(ev: AgenticSdlcEvent): FeedCategory {
  if (ev.projection_status === "failed") return "attention";
  if (ev.artifact_kind === "deploy" || ev.github_event_type === "deployment_status") {
    return "deploy";
  }
  if (ev.artifact_kind === "review" || ev.github_event_type?.includes("review")) {
    return "review";
  }
  if (ev.artifact_kind === "comment" || ev.github_event_type?.includes("comment")) {
    return "attention";
  }
  if (ev.artifact_kind === "pull_request" || ev.github_event_type === "pull_request") {
    return "pull_request";
  }
  if (ev.github_event_type?.startsWith("check_")) return "check";
  if (ev.github_event_type === "issues" || ev.github_event_type === "sub_issues") {
    return "issue";
  }
  if (ev.source === "ui") return "sync";
  return "issue";
}

function eventTone(ev: AgenticSdlcEvent, category: FeedCategory): FeedTone {
  if (ev.projection_status === "failed") return "failed";
  if (category === "deploy" && /success|succeeded|completed/.test(ev.github_action ?? "")) {
    return "success";
  }
  if (category === "attention") return "attention";
  if (ev.actor_kind === "agent") return "agent";
  if (ev.actor_kind === "human") return "human";
  return "default";
}

function eventTitle(ev: AgenticSdlcEvent, action: string): string {
  if (ev.projection_status === "failed") return "Projection needs attention";
  switch (eventCategory(ev)) {
    case "deploy":
      return `Deployment ${action}`;
    case "review":
      return `Review ${action}`;
    case "attention":
      return ev.artifact_kind === "comment" ? "Comment added" : `Attention ${action}`;
    case "pull_request":
      return `PR ${action}`;
    case "check":
      return `Check ${action}`;
    case "sync":
      return "GitHub state synced";
    case "issue":
    default:
      if (ev.github_event_type === "issues" || ev.github_event_type === "sub_issues") {
        return `Issue ${action}`;
      }
      return `${artifactKindLabel(ev.artifact_kind)} ${action}`;
  }
}

function actionLabel(action: string | null): string {
  if (!action) return "updated";
  if (action === "synchronize") return "synchronized";
  return action.replaceAll("_", " ");
}

function artifactLabelFor(ev: AgenticSdlcEvent): string {
  const prefix = artifactKindLabel(ev.artifact_kind).toLowerCase();
  return ev.artifact_id ? `${prefix} ${shortId(ev.artifact_id)}` : prefix;
}

function artifactKindLabel(kind: ArtifactKind): string {
  switch (kind) {
    case "pull_request":
      return "Pull request";
    case "subtask":
      return "Task";
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1).replaceAll("_", " ");
  }
}

function shortId(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

async function handle(
  req: Request,
  ctx: { params: Promise<{ owner: string; repo: string }> },
): Promise<Response> {
  const reader = await requireAgenticSdlcReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }

  const { owner, repo } = await ctx.params;
  const repos = await getAgenticSdlcReposCollection();
  const repoDoc = await repos.findOne(
    { owner, name: repo, offboarded_at: null },
    { projection: { repo_id: 1 } },
  );
  if (!repoDoc) {
    return Response.json(
      { error: "not_found", message: "Repo not onboarded." },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const limit = parseLimit(url);
  const page = parsePage(url);
  const events = await getAgenticSdlcEventsCollection();
  const scanLimit = Math.min(
    MAX_SCAN_LIMIT,
    Math.max(limit * page * 3, limit + 1),
  );
  const rows = await events
    .find(
      {
        repo_id: repoDoc.repo_id,
        $or: [
          { projection_status: "failed" },
          { source: "ui" },
          { artifact_kind: { $in: INTERESTING_ARTIFACT_KINDS } },
          { github_event_type: { $in: INTERESTING_EVENT_TYPES } },
        ],
      },
      { projection: { _id: 0, payload: 0 } },
    )
    .sort({ occurred_at: -1, delivered_at: -1 })
    .limit(scanLimit)
    .toArray();
  const deduped = dedupeEvents(rows);
  const start = (page - 1) * limit;
  const pageItems = deduped.slice(start, start + limit);

  return Response.json({
    items: pageItems
      .map(({ event, count }) => toFeedItem(event, count))
      .filter((item): item is RepoEventFeedItem => item !== null),
    pagination: {
      page,
      page_size: limit,
      page_size_options: [...PAGE_SIZE_OPTIONS],
      has_previous: page > 1,
      has_next: deduped.length > start + limit,
      total_visible: deduped.length,
    },
  });
}

export const GET = withAgenticSdlcGate(handle);
