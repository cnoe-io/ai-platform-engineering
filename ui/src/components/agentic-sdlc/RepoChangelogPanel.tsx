"use client";

/**
 * Repo changelog panel — feed of completed features in the lookback
 * window: merged Epics, merged PRs, and successful sandbox deploys.
 *
 * Reads from `GET /api/agentic-sdlc/repos/{owner}/{repo}/changelog`.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  BookCheck,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  GitMerge,
  Loader2,
  Maximize2,
  Rocket,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import type { ChangelogEntry, ChangelogEntryKind } from "@/types/agentic-sdlc";

interface RepoChangelogResponse {
  lookback_days: number;
  items: ChangelogEntry[];
}

const LOOKBACK_OPTIONS = [7, 30, 90] as const;

interface RepoChangelogPanelProps {
  owner: string;
  repo: string;
}

export function RepoChangelogPanel({ owner, repo }: RepoChangelogPanelProps) {
  const [lookback, setLookback] = useState<(typeof LOOKBACK_OPTIONS)[number]>(30);
  const [data, setData] = useState<RepoChangelogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFullscreen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(
        `/api/agentic-sdlc/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/changelog`,
        window.location.origin,
      );
      url.searchParams.set("lookbackDays", String(lookback));
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const body = (await res.json()) as Partial<RepoChangelogResponse>;
      const safe: RepoChangelogResponse = {
        lookback_days: body.lookback_days ?? lookback,
        items: Array.isArray(body.items) ? body.items : [],
      };
      setData(safe);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch_failed");
    } finally {
      setLoading(false);
    }
  }, [owner, repo, lookback]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    function onRepoSynced(event: Event) {
      const detail = (event as CustomEvent<{ owner?: string; repo?: string }>)
        .detail;
      if (detail?.owner === owner && detail?.repo === repo) {
        void loadData();
      }
    }
    window.addEventListener("agentic-sdlc:repo-synced", onRepoSynced);
    return () =>
      window.removeEventListener("agentic-sdlc:repo-synced", onRepoSynced);
  }, [owner, repo, loadData]);

  const grouped = useMemo(() => groupByDay(data?.items ?? []), [data]);

  const toolbar = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-1.5">
        {LOOKBACK_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setLookback(option)}
            className={`rounded-md border px-2 py-1 text-[10px] font-medium transition ${
              option === lookback
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border/40 bg-background/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            Last {option}d
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <p className="text-[11px] text-muted-foreground">
          {data ? `${data.items.length} completed` : ""}
        </p>
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label="Open changelog in full screen"
          title="Open in full screen"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/50 bg-background/50 px-2 text-[11px] font-medium text-muted-foreground transition hover:bg-background hover:text-foreground"
        >
          <Maximize2 className="h-3 w-3" aria-hidden />
          <span className="hidden sm:inline">Full screen</span>
        </button>
      </div>
    </div>
  );

  const list = (
    <>
      {error && (
        <p className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Could not load changelog ({error}).
        </p>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center rounded-md border border-border/30 bg-background/30 px-3 py-8 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden /> Loading
          changelog…
        </div>
      )}

      {data && data.items.length === 0 && !loading && (
        <p className="rounded-md border border-dashed border-border/40 bg-background/20 px-3 py-3 text-xs text-muted-foreground">
          Nothing has shipped in the last {lookback} days.
        </p>
      )}

      <ul className="space-y-3">
        {grouped.map(({ day, entries }) => (
          <li key={day}>
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <CalendarDays className="h-3 w-3" aria-hidden />
              {formatDayHeading(day)}
            </p>
            <ul className="space-y-1.5">
              {entries.map((entry) => (
                <ChangelogRow key={entry.id} entry={entry} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <>
      <CollapsiblePanel
        title="Changelog"
        defaultOpen={false}
        leading={<BookCheck className="h-4 w-4 text-emerald-300" aria-hidden />}
        subtitle="Merged Epics, merged PRs, and successful sandbox deploys."
        className="glass-panel"
        titleClassName="text-foreground normal-case tracking-normal"
      >
        {toolbar}
        <div className="max-h-[420px] overflow-y-auto pr-1">{list}</div>
      </CollapsiblePanel>

      {fullscreen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Changelog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget) setFullscreen(false);
          }}
        >
          <div className="glass-panel relative flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border/40 bg-card/85 shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-border/30 px-4 py-3">
              <div className="flex items-start gap-2">
                <BookCheck
                  className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300"
                  aria-hidden
                />
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Changelog
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Merged Epics, merged PRs, and successful sandbox deploys.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                aria-label="Close full-screen changelog"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-background/50 text-muted-foreground transition hover:bg-background hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>
            <div className="px-4 pt-3">{toolbar}</div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {list}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ChangelogRow({ entry }: { entry: ChangelogEntry }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-border/30 bg-background/30 px-3 py-2">
      <span className="mt-0.5 shrink-0">
        <KindIcon kind={entry.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <a
            href={entry.github_url}
            target="_blank"
            rel="noreferrer"
            className="truncate text-xs font-medium text-foreground transition hover:text-primary"
          >
            {entry.title}
          </a>
          <ExternalLink
            className="h-3 w-3 shrink-0 text-muted-foreground/70"
            aria-hidden
          />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="rounded-full border border-border/40 bg-background/40 px-1.5 py-0.5">
            {kindLabel(entry.kind)}
          </span>
          <span>{entry.actor_kind === "agent" ? "by agent" : "by human"}</span>
          <span className="text-muted-foreground/60">
            {new Date(entry.completed_at).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        {entry.body_excerpt && (
          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/85">
            {entry.body_excerpt}
          </p>
        )}
      </div>
    </li>
  );
}

function KindIcon({ kind }: { kind: ChangelogEntryKind }) {
  switch (kind) {
    case "epic_merged":
    case "pull_request_merged":
      return <GitMerge className="h-3.5 w-3.5 text-emerald-300" aria-hidden />;
    case "deploy_succeeded":
      return <Rocket className="h-3.5 w-3.5 text-cyan-300" aria-hidden />;
    case "epic_closed":
    default:
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" aria-hidden />;
  }
}

function kindLabel(kind: ChangelogEntryKind): string {
  switch (kind) {
    case "epic_merged":
      return "Epic merged";
    case "epic_closed":
      return "Epic closed";
    case "pull_request_merged":
      return "PR merged";
    case "deploy_succeeded":
      return "Deploy ok";
  }
}

function groupByDay(
  entries: ChangelogEntry[],
): { day: string; entries: ChangelogEntry[] }[] {
  const buckets = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    const d = new Date(entry.completed_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(d.getDate()).padStart(2, "0")}`;
    const arr = buckets.get(key) ?? [];
    arr.push(entry);
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries())
    .map(([day, list]) => ({ day, entries: list }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

function formatDayHeading(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const diffDays = Math.floor(
    (startOfToday.getTime() - date.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}
