"use client";

import {
  Bot,
  ChevronDown,
  GitPullRequest,
  Loader2,
  Rocket,
  ShieldAlert,
  User,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import {
  REPO_UPDATE_HIGHLIGHT_CLASS,
  repoUpdateHighlightStyle,
} from "@/lib/agentic-sdlc/highlight-timing";
import { useAgenticSdlcUiSettings } from "@/hooks/use-agentic-sdlc-ui-settings";
import { cn } from "@/lib/utils";

// assisted-by Codex Codex-sonnet-4-6

type FeedCategory =
  | "all"
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
  category: Exclude<FeedCategory, "all">;
  tone: FeedTone;
  title: string;
  description: string;
  actor_label: string;
  actor_kind: "agent" | "human" | "system";
  artifact_label: string;
  occurred_at: string;
  duplicate_count: number;
  details: RepoEventFeedDetails;
}

interface RepoEventFeedDetails {
  source: "github" | "ui";
  github_event_type: string | null;
  github_action: string | null;
  artifact_kind: string;
  artifact_id: string;
  epic_id: string | null;
  projection_status: string;
  delivered_at: string;
}

interface RepoEventFeedResponse {
  items?: RepoEventFeedItem[];
  pagination?: RepoEventFeedPagination;
}

interface RepoEventFeedPagination {
  page: number;
  page_size: number;
  page_size_options: number[];
  has_previous: boolean;
  has_next: boolean;
  total_visible: number;
}

interface RepoEventFeedProps {
  owner: string;
  repo: string;
}

interface RepoRefreshDetail {
  owner?: string;
  repo?: string;
  changedArtifactIds?: string[];
}

const FILTERS: Array<{ id: FeedCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "issue", label: "Issues" },
  { id: "pull_request", label: "PRs" },
  { id: "deploy", label: "Deploys" },
  { id: "review", label: "Reviews" },
  { id: "check", label: "Checks" },
  { id: "sync", label: "Sync" },
];

const TONE_CLASS: Record<FeedTone, string> = {
  agent: "border-primary/30 bg-primary/10 text-primary",
  attention: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  default: "border-border/40 bg-muted/30 text-muted-foreground",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  human: "border-sky-400/35 bg-sky-400/10 text-sky-200",
  success: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
};

export function RepoEventFeed({ owner, repo }: RepoEventFeedProps) {
  const [items, setItems] = useState<RepoEventFeedItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [filter, setFilter] = useState<FeedCategory>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<RepoEventFeedPagination | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [highlightedArtifactIds, setHighlightedArtifactIds] = useState<Set<string>>(new Set());
  const hasLoadedRef = useRef(false);
  const highlightTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { settings } = useAgenticSdlcUiSettings();

  const highlightChangedArtifacts = useCallback((ids: string[] | undefined) => {
    const validIds = (ids ?? []).filter(Boolean);
    if (validIds.length === 0) return;
    setHighlightedArtifactIds((current) => {
      const next = new Set(current);
      validIds.forEach((id) => next.add(id));
      return next;
    });
    const timer = setTimeout(() => {
      setHighlightedArtifactIds((current) => {
        const next = new Set(current);
        validIds.forEach((id) => next.delete(id));
        return next;
      });
    }, settings.haloDurationSeconds * 1000);
    highlightTimersRef.current.push(timer);
  }, [settings.haloDurationSeconds]);

  useEffect(() => {
    function onRepoSynced(event: Event) {
      const detail = (event as CustomEvent<RepoRefreshDetail>).detail;
      if (detail?.owner === owner && detail?.repo === repo) {
        highlightChangedArtifacts(detail.changedArtifactIds);
        setRefreshKey((value) => value + 1);
      }
    }
    window.addEventListener("agentic-sdlc:repo-synced", onRepoSynced);
    return () => window.removeEventListener("agentic-sdlc:repo-synced", onRepoSynced);
  }, [highlightChangedArtifacts, owner, repo]);

  useEffect(() => {
    return () => {
      highlightTimersRef.current.forEach((timer) => clearTimeout(timer));
      highlightTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const backgroundRefresh = hasLoadedRef.current;
      if (backgroundRefresh) {
        setIsRefreshing(true);
      } else {
        setStatus("loading");
      }
      try {
        const res = await fetch(
          `/api/agentic-sdlc/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/event-feed?limit=${pageSize}&page=${page}`,
          { headers: { Accept: "application/json" }, cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as RepoEventFeedResponse;
        if (!cancelled) {
          setItems(body.items ?? []);
          setPagination(body.pagination ?? null);
          hasLoadedRef.current = true;
          setStatus("ready");
        }
      } catch {
        if (!cancelled && !backgroundRefresh) setStatus("error");
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [owner, page, pageSize, repo, refreshKey]);

  const visibleItems = useMemo(
    () => items.filter((item) => filter === "all" || item.category === filter),
    [filter, items],
  );

  return (
    <CollapsiblePanel
      title="Repo event feed"
      subtitle="Curated lifecycle, PR, deploy, review, and human-attention events. Raw webhook JSON stays server-side."
      className="bg-card/30"
      contentClassName="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setFilter(option.id);
                setExpandedId(null);
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                filter === option.id
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border/40 bg-background/35 text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
          Show events
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
              setExpandedId(null);
            }}
            className="rounded-md border border-border/40 bg-background/60 px-2 py-1 text-xs text-foreground"
          >
            {(pagination?.page_size_options ?? [10, 25, 50, 100, 500]).map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isRefreshing && status === "ready" ? (
        <div className="inline-flex w-fit items-center rounded-full border border-primary/25 bg-primary/10 px-2 py-1 text-[11px] text-primary motion-safe:animate-in motion-safe:fade-in-0">
          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />
          Revealing new repo events without clearing the feed…
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="rounded-lg border border-border/30 bg-background/30 px-3 py-5 text-xs text-muted-foreground">
          Loading curated repo events...
        </div>
      ) : status === "error" ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-5 text-xs text-destructive">
          Could not load the repo event feed.
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 bg-background/25 px-3 py-5 text-center text-xs text-muted-foreground">
          No curated events match this filter yet.
        </div>
      ) : (
        <ol className="divide-y divide-border/25 overflow-visible rounded-lg border border-border/30 bg-background/25" aria-label="Repo event feed">
          {visibleItems.map((item, index) => (
            <RepoEventRow
              key={item.id}
              item={item}
              highlighted={highlightedArtifactIds.has(item.details.artifact_id)}
              revealIndex={highlightedArtifactIds.has(item.details.artifact_id) ? index : 0}
              haloColor={settings.haloColor}
              expanded={expandedId === item.id}
              onToggle={() =>
                setExpandedId((current) => (current === item.id ? null : item.id))
              }
            />
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          Page {pagination?.page ?? page}
          {pagination ? ` · ${pagination.total_visible} unique events` : ""}
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              setPage((value) => Math.max(1, value - 1));
              setExpandedId(null);
            }}
            disabled={!pagination?.has_previous}
            className="rounded-md border border-border/40 px-2 py-1 transition hover:bg-background/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous page
          </button>
          <button
            type="button"
            onClick={() => {
              setPage((value) => value + 1);
              setExpandedId(null);
            }}
            disabled={!pagination?.has_next}
            className="rounded-md border border-border/40 px-2 py-1 transition hover:bg-background/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next page
          </button>
        </div>
      </div>
    </CollapsiblePanel>
  );
}

function RepoEventRow({
  item,
  expanded,
  highlighted,
  revealIndex,
  haloColor,
  onToggle,
}: {
  item: RepoEventFeedItem;
  expanded: boolean;
  highlighted: boolean;
  revealIndex: number;
  haloColor: string;
  onToggle: () => void;
}) {
  const Icon =
    item.category === "deploy"
      ? Rocket
      : item.category === "pull_request" || item.category === "review"
        ? GitPullRequest
        : item.tone === "attention" || item.tone === "failed"
          ? ShieldAlert
          : item.actor_kind === "agent"
            ? Bot
            : item.actor_kind === "human"
              ? User
              : Workflow;

  return (
    <li
      className={cn(
        "bg-background/20 transition",
        highlighted && REPO_UPDATE_HIGHLIGHT_CLASS,
      )}
      style={highlighted ? repoUpdateHighlightStyle(haloColor, revealIndex) : undefined}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left transition hover:bg-background/45"
      >
        <span
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
            TONE_CLASS[item.tone],
          )}
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium text-foreground">
              {item.title}
            </span>
            <span className="rounded border border-border/40 bg-muted/30 px-1.5 py-px text-[10px] text-muted-foreground">
              {item.category.replace("_", " ")}
            </span>
            <span className="rounded border border-border/40 bg-muted/30 px-1.5 py-px text-[10px] text-muted-foreground">
              {item.actor_label}
            </span>
            {item.duplicate_count > 1 ? (
              <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-px text-[10px] text-amber-200">
                {item.duplicate_count} repeats
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {item.description}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground/70">
          <time>{formatRelative(item.occurred_at)}</time>
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
        </span>
      </button>
      {expanded ? <EventDetail details={item.details} occurredAt={item.occurred_at} /> : null}
    </li>
  );
}

function EventDetail({
  details,
  occurredAt,
}: {
  details: RepoEventFeedDetails;
  occurredAt: string;
}) {
  return (
    <div className="border-t border-border/25 bg-background/35 px-12 py-3">
      <dl className="grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Event type" value={details.github_event_type ?? "unknown"} />
        <Detail label="Action" value={details.github_action ?? "updated"} />
        <Detail label="Source" value={details.source} />
        <Detail label="Projection" value={details.projection_status} />
        <Detail label="Artifact kind" value={details.artifact_kind} />
        <Detail label="Artifact id" value={details.artifact_id || "unknown"} />
        <Detail label="Epic id" value={details.epic_id ?? "none"} />
        <Detail label="Occurred" value={formatTimestamp(occurredAt)} />
        <Detail label="Delivered" value={formatTimestamp(details.delivered_at)} />
      </dl>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-medium text-foreground">{value}</dd>
    </div>
  );
}

function formatRelative(input: string): string {
  const t = Date.parse(input);
  if (Number.isNaN(t)) return "unknown";
  const diff = Date.now() - t;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(t).toLocaleDateString();
}

function formatTimestamp(input: string): string {
  const t = Date.parse(input);
  if (Number.isNaN(t)) return "unknown";
  return new Date(t).toLocaleString();
}
