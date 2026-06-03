"use client";

/**
 * Repo CI panel — shows live CI status for every in-flight task / PR.
 *
 * Reads from `GET /api/agentic-sdlc/repos/{owner}/{repo}/ci`. The
 * panel offers an optional "Refresh from GitHub" action that calls
 * the same route with `?live=true`, which merges fresh check-runs
 * from the GitHub API on top of projected webhook data.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import { StageBadge } from "@/components/agentic-sdlc/visualizations/StageBadge";
import type {
  AgenticSdlcStage,
  ArtifactCiSummary,
  ArtifactKindStored,
  ArtifactNativeState,
  CiCheckRun,
  CiConclusion,
} from "@/types/agentic-sdlc";

interface InFlightCiItem {
  artifact_id: string;
  kind: ArtifactKindStored;
  title: string;
  current_stage: AgenticSdlcStage;
  github_url: string;
  state: ArtifactNativeState;
  head_sha: string | null;
  ci_summary: ArtifactCiSummary | null;
  last_event_at: string;
  checks: CiCheckRun[];
}

interface RepoCiResponse {
  totals: { success: number; failure: number; pending: number; no_ci: number };
  items: InFlightCiItem[];
  live_refreshed: boolean;
}

interface RepoCiPanelProps {
  owner: string;
  repo: string;
}

export function RepoCiPanel({ owner, repo }: RepoCiPanelProps) {
  const [data, setData] = useState<RepoCiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [liveRefreshed, setLiveRefreshed] = useState(false);

  const loadData = useCallback(
    async (live: boolean) => {
      setRefreshing(true);
      setError(null);
      try {
        const url = new URL(
          `/api/agentic-sdlc/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/ci`,
          window.location.origin,
        );
        if (live) url.searchParams.set("live", "true");
        const res = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`http_${res.status}`);
        const body = (await res.json()) as Partial<RepoCiResponse>;
        const safe: RepoCiResponse = {
          totals: body.totals ?? { success: 0, failure: 0, pending: 0, no_ci: 0 },
          items: Array.isArray(body.items) ? body.items : [],
          live_refreshed: Boolean(body.live_refreshed),
        };
        setData(safe);
        setLiveRefreshed(safe.live_refreshed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "fetch_failed");
      } finally {
        setRefreshing(false);
      }
    },
    [owner, repo],
  );

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  useEffect(() => {
    function onRepoSynced(event: Event) {
      const detail = (event as CustomEvent<{ owner?: string; repo?: string }>)
        .detail;
      if (detail?.owner === owner && detail?.repo === repo) {
        void loadData(false);
      }
    }
    window.addEventListener("agentic-sdlc:repo-synced", onRepoSynced);
    return () =>
      window.removeEventListener("agentic-sdlc:repo-synced", onRepoSynced);
  }, [owner, repo, loadData]);

  return (
    <CollapsiblePanel
      title="CI for tasks-in-flight"
      leading={<ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden />}
      subtitle="Per-PR / per-task check status from check_run, check_suite, and workflow_run events."
      className="glass-panel"
      titleClassName="text-foreground normal-case tracking-normal"
    >
      <div className="flex items-center justify-between gap-3 pb-3">
        <CiTotals data={data} />
        <button
          type="button"
          onClick={() => loadData(true)}
          disabled={refreshing}
          aria-label="Refresh CI from GitHub"
          className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:bg-background hover:text-foreground disabled:opacity-60"
        >
          {refreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3 w-3" aria-hidden />
          )}
          Refresh CI
        </button>
      </div>

      {liveRefreshed && (
        <p className="mb-2 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">
          CI was refreshed live from GitHub for tracked head SHAs.
        </p>
      )}

      {error && (
        <p className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden /> Could not
          load CI ({error}). Showing the last known state.
        </p>
      )}

      {!data && !error && (
        <div className="flex items-center justify-center rounded-md border border-border/30 bg-background/30 px-3 py-8 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden /> Loading
          CI…
        </div>
      )}

      {data && data.items.length === 0 && (
        <p className="rounded-md border border-border/30 bg-background/30 px-3 py-3 text-xs text-muted-foreground">
          No PRs or tasks are in flight right now.
        </p>
      )}

      {data && data.items.length > 0 && (
        <ul className="space-y-2">
          {data.items.map((item) => (
            <CiItemRow key={`${item.kind}:${item.artifact_id}`} item={item} />
          ))}
        </ul>
      )}
    </CollapsiblePanel>
  );
}

function CiTotals({ data }: { data: RepoCiResponse | null }) {
  if (!data) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Loading CI summary…
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <TotalsPill tone="success" label="Passing" value={data.totals.success} />
      <TotalsPill tone="failure" label="Failing" value={data.totals.failure} />
      <TotalsPill tone="pending" label="Running" value={data.totals.pending} />
      <TotalsPill tone="neutral" label="No CI" value={data.totals.no_ci} />
    </div>
  );
}

function TotalsPill({
  tone,
  label,
  value,
}: {
  tone: "success" | "failure" | "pending" | "neutral";
  label: string;
  value: number;
}) {
  const classes = {
    success: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
    failure: "border-red-400/30 bg-red-500/10 text-red-200",
    pending: "border-amber-400/30 bg-amber-500/10 text-amber-200",
    neutral: "border-border/40 bg-background/30 text-muted-foreground",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${classes}`}
    >
      <span>{label}</span>
      <span className="text-foreground">{value}</span>
    </span>
  );
}

function CiItemRow({ item }: { item: InFlightCiItem }) {
  const summary = item.ci_summary;
  const hasSummary = summary !== null;
  return (
    <li className="rounded-lg border border-border/30 bg-background/30 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ConclusionIcon
              conclusion={hasSummary ? summary.conclusion : "unknown"}
            />
            <a
              href={item.github_url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-xs font-semibold text-foreground transition hover:text-primary"
            >
              {item.title || item.artifact_id}
            </a>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            <StageBadge stage={item.current_stage} compact />
            <span className="rounded-full border border-border/40 bg-background/40 px-1.5 py-0.5">
              {item.kind.replaceAll("_", " ")}
            </span>
            {item.head_sha && (
              <span className="font-mono">{item.head_sha.slice(0, 7)}</span>
            )}
            <span>{formatRelative(item.last_event_at)}</span>
          </div>
        </div>
      </div>
      {hasSummary ? (
        <CiCheckTable summary={summary} checks={item.checks} />
      ) : (
        <p className="mt-2 text-[11px] italic text-muted-foreground">
          No CI events recorded yet for this artifact.
        </p>
      )}
    </li>
  );
}

function CiCheckTable({
  summary,
  checks,
}: {
  summary: ArtifactCiSummary;
  checks: CiCheckRun[];
}) {
  if (checks.length === 0) {
    return (
      <p className="mt-2 text-[11px] text-muted-foreground">
        Aggregate {summary.conclusion} — no per-check detail available.
      </p>
    );
  }
  return (
    <ul className="mt-2 space-y-1">
      {checks.map((check) => (
        <li
          key={check.external_id}
          className="flex items-center justify-between gap-2 rounded border border-border/30 bg-background/40 px-2 py-1 text-[11px]"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <ConclusionIcon conclusion={check.conclusion} />
            <span className="truncate text-foreground">{check.check_name}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
            <span className="font-mono text-[10px] uppercase">
              {check.status === "completed" ? check.conclusion : check.status}
            </span>
            {check.details_url && (
              <a
                href={check.details_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:text-primary/80"
                aria-label={`Open ${check.check_name} details`}
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ConclusionIcon({ conclusion }: { conclusion: CiConclusion }) {
  if (conclusion === "success") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-hidden />;
  }
  if (
    conclusion === "failure" ||
    conclusion === "timed_out" ||
    conclusion === "action_required"
  ) {
    return <XCircle className="h-3.5 w-3.5 text-red-300" aria-hidden />;
  }
  if (conclusion === "pending") {
    return (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-200" aria-hidden />
    );
  }
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />;
}

function formatRelative(value: string): string {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "";
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
