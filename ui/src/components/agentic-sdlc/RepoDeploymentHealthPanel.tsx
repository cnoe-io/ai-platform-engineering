"use client";

/**
 * Repo deployment health panel — rich per-environment health with
 * success rate, recent deploys timeline, and failure reasons.
 *
 * Reads from
 * `GET /api/agentic-sdlc/repos/{owner}/{repo}/deploy-health`.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Heart,
  Loader2,
  Server,
  Timer,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import type {
  DeploymentEnvironmentHealth,
  DeploymentEnvironmentSummary,
  DeploymentHealthSummary,
  DeploymentRecord,
} from "@/types/agentic-sdlc";

const WINDOW_OPTIONS: { id: number; label: string }[] = [
  { id: 24, label: "24h" },
  { id: 168, label: "7d" },
  { id: 720, label: "30d" },
];

interface RepoDeploymentHealthPanelProps {
  owner: string;
  repo: string;
}

export function RepoDeploymentHealthPanel({
  owner,
  repo,
}: RepoDeploymentHealthPanelProps) {
  const [windowHours, setWindowHours] = useState<number>(168);
  const [data, setData] = useState<DeploymentHealthSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(
        `/api/agentic-sdlc/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/deploy-health`,
        window.location.origin,
      );
      url.searchParams.set("windowHours", String(windowHours));
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const body = (await res.json()) as Partial<DeploymentHealthSummary>;
      const safe: DeploymentHealthSummary = {
        window_hours: body.window_hours ?? windowHours,
        environments: Array.isArray(body.environments) ? body.environments : [],
        totals: body.totals ?? { success: 0, failure: 0, in_progress: 0 },
        generated_at: body.generated_at ?? new Date().toISOString(),
      };
      setData(safe);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch_failed");
    } finally {
      setLoading(false);
    }
  }, [owner, repo, windowHours]);

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

  return (
    <CollapsiblePanel
      title="Deployment health"
      leading={<Heart className="h-4 w-4 text-rose-300" aria-hidden />}
      subtitle="Per-environment success rate, recent deploys, and failure reasons."
      className="glass-panel"
      titleClassName="text-foreground normal-case tracking-normal"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Totals data={data} />
        <div className="flex gap-1.5">
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setWindowHours(option.id)}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium transition ${
                option.id === windowHours
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border/40 bg-background/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden /> Could not
          load deployment health ({error}).
        </p>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center rounded-md border border-border/30 bg-background/30 px-3 py-8 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden /> Loading
          deploy health…
        </div>
      )}

      {data && data.environments.length === 0 && !loading && (
        <p className="rounded-md border border-dashed border-border/40 bg-background/20 px-3 py-3 text-xs text-muted-foreground">
          No deployments observed in the selected window.
        </p>
      )}

      <ul className="space-y-3">
        {data?.environments.map((env) => (
          <EnvironmentCard key={env.environment} env={env} />
        ))}
      </ul>
    </CollapsiblePanel>
  );
}

function Totals({ data }: { data: DeploymentHealthSummary | null }) {
  if (!data) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Loading deploy totals…
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
        <CheckCircle2 className="h-3 w-3" aria-hidden /> Success
        <span className="text-foreground">{data.totals.success}</span>
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-red-200">
        <XCircle className="h-3 w-3" aria-hidden /> Failure
        <span className="text-foreground">{data.totals.failure}</span>
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">
        <Activity className="h-3 w-3" aria-hidden /> Running
        <span className="text-foreground">{data.totals.in_progress}</span>
      </span>
    </div>
  );
}

function EnvironmentCard({ env }: { env: DeploymentEnvironmentSummary }) {
  return (
    <li className="rounded-xl border border-border/30 bg-background/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Server className="h-4 w-4 text-cyan-200" aria-hidden />
          <p className="truncate text-sm font-semibold text-foreground">
            {env.environment}
          </p>
          <HealthBadge health={env.health} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            Success {(env.success_rate * 100).toFixed(0)}% (
            {env.success_count}/{env.success_count + env.failure_count})
          </span>
          {env.median_duration_seconds != null && (
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3 w-3" aria-hidden />
              {formatDuration(env.median_duration_seconds)} median
            </span>
          )}
          {env.median_recovery_seconds != null && (
            <span className="inline-flex items-center gap-1">
              <Activity className="h-3 w-3" aria-hidden />
              {formatDuration(env.median_recovery_seconds)} MTTR
            </span>
          )}
        </div>
      </div>

      <ul className="mt-2 space-y-1">
        {env.recent_deploys.length === 0 && (
          <li className="rounded-md border border-dashed border-border/30 px-2 py-1 text-[11px] text-muted-foreground">
            No deploys observed for this environment in the window.
          </li>
        )}
        {env.recent_deploys.map((record) => (
          <DeployRow key={record.id} record={record} />
        ))}
      </ul>
    </li>
  );
}

function DeployRow({ record }: { record: DeploymentRecord }) {
  const tone =
    record.state === "success"
      ? "border-emerald-400/30 bg-emerald-500/10"
      : record.state === "failure"
        ? "border-red-400/30 bg-red-500/10"
        : "border-amber-400/30 bg-amber-500/10";
  return (
    <li className={`flex flex-wrap items-start justify-between gap-2 rounded-md border px-2.5 py-1.5 ${tone}`}>
      <div className="flex min-w-0 items-start gap-2 text-[11px]">
        <DeployIcon state={record.state} />
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">
            {record.url ? (
              <a
                href={record.url}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                {record.environment}
                <ExternalLink
                  className="ml-1 inline h-3 w-3 text-muted-foreground/70"
                  aria-hidden
                />
              </a>
            ) : (
              record.environment
            )}
          </p>
          {record.failure_reason && (
            <p className="mt-0.5 text-red-200">{record.failure_reason}</p>
          )}
          {!record.failure_reason && record.description && (
            <p className="mt-0.5 line-clamp-1 text-muted-foreground">
              {record.description}
            </p>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right text-[10px] text-muted-foreground">
        <p>{record.completed_at ? formatRelative(record.completed_at) : "in progress"}</p>
        {record.duration_seconds != null && (
          <p>{formatDuration(record.duration_seconds)}</p>
        )}
      </div>
    </li>
  );
}

function HealthBadge({ health }: { health: DeploymentEnvironmentHealth }) {
  const classes = {
    healthy: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
    degraded: "border-amber-400/30 bg-amber-500/10 text-amber-200",
    failing: "border-red-400/30 bg-red-500/10 text-red-200",
    idle: "border-border/40 bg-background/30 text-muted-foreground",
    unknown: "border-border/40 bg-background/30 text-muted-foreground",
  }[health];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${classes}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {health}
    </span>
  );
}

function DeployIcon({ state }: { state: DeploymentRecord["state"] }) {
  if (state === "success") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-hidden />;
  }
  if (state === "failure") {
    return <XCircle className="h-3.5 w-3.5 text-red-300" aria-hidden />;
  }
  return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-200" aria-hidden />;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${Math.round(seconds / 86_400)}d`;
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
