"use client";

import { AlertTriangle, BarChart3, GitPullRequest, Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";

import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import { StageBadge } from "@/components/agentic-sdlc/visualizations/StageBadge";
import type { AgenticSdlcStage, ArtifactKindStored } from "@/types/agentic-sdlc";

interface RepoOperatingMetricsProps {
  owner: string;
  repo: string;
}

interface RepoSummary {
  counts: {
    open_epics: number;
    in_flight_subtasks: number;
    prs_awaiting_review: number;
    deploys_24h: number;
  };
  activity_24h: number;
  stage_counts: { stage: AgenticSdlcStage; count: number }[];
  human_queue: {
    needs_human_count: number;
    oldest_waiting_since: string | null;
    items: Array<{
      artifact_id: string;
      kind: ArtifactKindStored;
      title: string;
      current_stage: AgenticSdlcStage;
      github_url: string;
      last_event_at: string;
    }>;
  };
}

export function RepoOperatingMetrics({
  owner,
  repo,
}: RepoOperatingMetricsProps) {
  const [summary, setSummary] = useState<RepoSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    function onRepoSynced(event: Event) {
      const detail = (event as CustomEvent<{ owner?: string; repo?: string }>).detail;
      if (detail?.owner === owner && detail?.repo === repo) {
        setRefreshKey((value) => value + 1);
      }
    }
    window.addEventListener("agentic-sdlc:repo-synced", onRepoSynced);
    return () => window.removeEventListener("agentic-sdlc:repo-synced", onRepoSynced);
  }, [owner, repo]);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setError(null);

    const url = `/api/agentic-sdlc/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    (async () => {
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setError(`http_${res.status}`);
          return;
        }
        const body = (await res.json()) as RepoSummary;
        if (!cancelled) setSummary(body);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "fetch_failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [owner, repo, refreshKey]);

  if (error) {
    return (
      <aside className="space-y-3">
        <MetricPanel title="Repo operating snapshot" icon={BarChart3}>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />
            Could not load repo metrics ({error}).
          </div>
        </MetricPanel>
      </aside>
    );
  }

  if (!summary) {
    return (
      <aside className="space-y-3">
        <MetricPanel title="Repo operating snapshot" icon={BarChart3}>
          <div className="flex items-center justify-center rounded-lg border border-border/30 bg-background/30 px-3 py-8 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden />
            Loading repo metrics…
          </div>
        </MetricPanel>
      </aside>
    );
  }

  return (
    <aside className="space-y-3">
      <MetricPanel title="Repo operating snapshot" icon={BarChart3}>
        <StageSummary stageCounts={summary.stage_counts} />
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <MetricPill label="Open Epics" value={summary.counts.open_epics} />
          <MetricPill
            label="Active Tasks"
            value={summary.counts.in_flight_subtasks}
          />
          <MetricPill
            label="Review PRs"
            value={summary.counts.prs_awaiting_review}
          />
          <MetricPill
            label="Deploys 24h"
            value={summary.counts.deploys_24h}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {summary.activity_24h} events in the last 24h from webhook projection.
        </p>
      </MetricPanel>

      <MetricPanel title="Human queue" icon={GitPullRequest}>
        <div className="flex items-baseline justify-between">
          <p className="text-2xl font-semibold text-foreground">
            {summary.human_queue.needs_human_count}
          </p>
          <p className="text-xs text-muted-foreground">items need attention</p>
        </div>
        {summary.human_queue.oldest_waiting_since && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Oldest waiting since{" "}
            {formatShortDate(summary.human_queue.oldest_waiting_since)}
          </p>
        )}
        <div className="mt-3 space-y-2">
          {summary.human_queue.items.length === 0 ? (
            <p className="rounded-lg border border-border/30 bg-background/30 px-3 py-3 text-xs text-muted-foreground">
              No PRs or tasks are waiting on a human right now.
            </p>
          ) : (
            summary.human_queue.items.map((item) => (
              <a
                key={item.artifact_id}
                href={item.github_url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-border/30 bg-background/30 px-3 py-2 transition hover:bg-background/50"
              >
                <div className="flex items-center gap-2">
                  <StageBadge stage={item.current_stage} compact />
                  <span className="truncate text-xs font-medium text-foreground">
                    {item.title}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {item.kind.replace("_", " ")} ·{" "}
                  {formatShortDate(item.last_event_at)}
                </p>
              </a>
            ))
          )}
        </div>
      </MetricPanel>
    </aside>
  );
}

function StageSummary({
  stageCounts,
}: {
  stageCounts: { stage: AgenticSdlcStage; count: number }[];
}) {
  const visibleStageCounts = useMemo(
    () => stageCounts.filter((item) => item.stage !== "unknown"),
    [stageCounts],
  );
  return (
    <div className="mt-4 rounded-lg border border-border/30 bg-background/30 p-3">
      {visibleStageCounts.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No staged Agentic SDLC work yet.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {visibleStageCounts.map((item) => (
            <span
              key={item.stage}
              className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-card/60 px-2 py-1 text-[10px] text-muted-foreground"
            >
              <StageBadge stage={item.stage} compact />
              <span className="font-semibold text-foreground">{item.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricPanel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
}) {
  return (
    <CollapsiblePanel
      title={title}
      leading={<Icon className="h-4 w-4 text-sky-300" aria-hidden />}
      className="glass-panel"
      titleClassName="text-foreground normal-case tracking-normal"
      contentClassName="pt-3"
    >
      {children}
    </CollapsiblePanel>
  );
}

function MetricPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/30 bg-background/30 px-3 py-2">
      <p className="text-lg font-semibold text-foreground">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
