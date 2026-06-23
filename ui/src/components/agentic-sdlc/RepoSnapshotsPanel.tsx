"use client";

/**
 * Repo snapshots panel — shows snapshot artifacts produced during the
 * last X runs: GitHub Actions workflow runs, deploy snapshots, and
 * recent agentic artifacts. Reads from
 * `GET /api/agentic-sdlc/repos/{owner}/{repo}/snapshots`.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  Box,
  Container,
  ExternalLink,
  GitBranch,
  Loader2,
  Package,
  Rocket,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import type {
  SnapshotArtifactKind,
  SnapshotArtifactRecord,
} from "@/types/agentic-sdlc";

interface RepoSnapshotsResponse {
  recent_runs: number;
  window_hours: number;
  by_kind: Record<SnapshotArtifactKind, number>;
  items: SnapshotArtifactRecord[];
}

const RUN_OPTIONS = [5, 10, 25] as const;
const KIND_FILTERS: { id: "all" | SnapshotArtifactKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "github_actions_artifact", label: "GH Actions" },
  { id: "deploy_snapshot", label: "Deploy snapshots" },
  { id: "agentic_artifact", label: "Agentic" },
];

interface RepoSnapshotsPanelProps {
  owner: string;
  repo: string;
}

export function RepoSnapshotsPanel({ owner, repo }: RepoSnapshotsPanelProps) {
  const [runs, setRuns] = useState<(typeof RUN_OPTIONS)[number]>(5);
  const [kindFilter, setKindFilter] = useState<"all" | SnapshotArtifactKind>("all");
  const [data, setData] = useState<RepoSnapshotsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(
        `/api/agentic-sdlc/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/snapshots`,
        window.location.origin,
      );
      url.searchParams.set("recentRuns", String(runs));
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const body = (await res.json()) as Partial<RepoSnapshotsResponse>;
      const safe: RepoSnapshotsResponse = {
        recent_runs: body.recent_runs ?? runs,
        window_hours: body.window_hours ?? 24,
        by_kind:
          body.by_kind ??
          ({
            github_actions_artifact: 0,
            deploy_snapshot: 0,
            agentic_artifact: 0,
          } as Record<SnapshotArtifactKind, number>),
        items: Array.isArray(body.items) ? body.items : [],
      };
      setData(safe);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch_failed");
    } finally {
      setLoading(false);
    }
  }, [owner, repo, runs]);

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

  const filtered =
    kindFilter === "all"
      ? (data?.items ?? [])
      : (data?.items ?? []).filter((item) => item.kind === kindFilter);

  return (
    <CollapsiblePanel
      title="Snapshot artifacts"
      leading={<Package className="h-4 w-4 text-violet-300" aria-hidden />}
      subtitle={`Build artifacts, deploy snapshots, and agentic outputs from the last ${runs} runs.`}
      className="glass-panel"
      titleClassName="text-foreground normal-case tracking-normal"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {KIND_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setKindFilter(option.id)}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium transition ${
                option.id === kindFilter
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border/40 bg-background/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
              {data && option.id !== "all" && (
                <span className="ml-1 text-foreground">
                  {data.by_kind[option.id as SnapshotArtifactKind]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {RUN_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRuns(option)}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium transition ${
                option === runs
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border/40 bg-background/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              {option} runs
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Could not load snapshots ({error}).
        </p>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center rounded-md border border-border/30 bg-background/30 px-3 py-8 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden /> Loading
          snapshots…
        </div>
      )}

      {data && filtered.length === 0 && !loading && (
        <p className="rounded-md border border-dashed border-border/40 bg-background/20 px-3 py-3 text-xs text-muted-foreground">
          No snapshot artifacts produced in the last {runs} runs.
        </p>
      )}

      <ul className="space-y-1.5">
        {filtered.map((item) => (
          <SnapshotRow key={item.id} item={item} />
        ))}
      </ul>
    </CollapsiblePanel>
  );
}

function SnapshotRow({ item }: { item: SnapshotArtifactRecord }) {
  const toneClasses = {
    success: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
    failure: "border-red-400/30 bg-red-500/10 text-red-100",
    neutral: "border-border/30 bg-background/30 text-foreground",
  }[item.tone];

  return (
    <li className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${toneClasses}`}>
      <span className="mt-0.5 shrink-0">
        <SnapshotIcon kind={item.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-1 truncate text-xs font-medium hover:underline"
            >
              <span className="truncate">{item.title}</span>
              <ExternalLink
                className="h-3 w-3 shrink-0 text-muted-foreground/70"
                aria-hidden
              />
            </a>
          ) : (
            <span className="truncate text-xs font-medium">{item.title}</span>
          )}
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {formatRelative(item.produced_at)}
          </span>
        </div>
        {item.subtitle && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {item.subtitle}
          </p>
        )}
        {item.size_bytes != null && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {formatSize(item.size_bytes)}
          </p>
        )}
      </div>
    </li>
  );
}

function SnapshotIcon({ kind }: { kind: SnapshotArtifactKind }) {
  switch (kind) {
    case "github_actions_artifact":
      return <Container className="h-4 w-4 text-violet-200" aria-hidden />;
    case "deploy_snapshot":
      return <Rocket className="h-4 w-4 text-cyan-200" aria-hidden />;
    case "agentic_artifact":
    default:
      return kind === "agentic_artifact" ? (
        <GitBranch className="h-4 w-4 text-emerald-200" aria-hidden />
      ) : (
        <Box className="h-4 w-4 text-muted-foreground" aria-hidden />
      );
  }
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
