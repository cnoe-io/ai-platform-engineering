"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  TomeAuthorizationHealthSnapshot,
  TomeAuthorizationHealthStatus,
} from "@/lib/tome/authorization-health";

const STATUS_STYLE: Record<
  TomeAuthorizationHealthStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  healthy: {
    label: "Healthy",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  reconciling: {
    label: "Reconciling",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    icon: Loader2,
  },
  degraded: {
    label: "Degraded",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: AlertTriangle,
  },
  blocked: {
    label: "Blocked",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: ShieldAlert,
  },
};

function formatTimestamp(value?: string): string {
  if (!value) return "Scan in progress";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function TomeAuthorizationHealthTab() {
  const [health, setHealth] = useState<TomeAuthorizationHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/tome/admin/authorization-health", {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to load authorization health");
      setHealth(body.health);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (health?.status !== "reconciling") return;
    const poll = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(poll);
  }, [health?.status, load]);

  const repair = async () => {
    setRepairing(true);
    setError(null);
    try {
      const response = await fetch("/api/tome/admin/authorization-health", {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Authorization repair failed");
      setHealth(body.health);
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : String(repairError));
    } finally {
      setRepairing(false);
    }
  };

  if (loading && !health) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border p-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading authorization health…
      </div>
    );
  }

  const status = health?.status ?? "blocked";
  const statusStyle = STATUS_STYLE[status];
  const StatusIcon = statusStyle.icon;
  const unresolved = health?.issues.filter((issue) => !issue.repaired) ?? [];
  const repaired = health?.issues.filter((issue) => issue.repaired) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-lg font-semibold">Authorization health</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Tome automatically restores document-steward and team-membership relationships from
            canonical application data. This page reports exceptions; it never creates membership
            intent or assigns a different steward.
          </p>
        </div>
        {health && health.status !== "healthy" && (
          <Button onClick={() => void repair()} disabled={repairing || status === "reconciling"}>
            {repairing || status === "reconciling" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Retry now
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={cn("rounded-xl border p-4", statusStyle.className)}>
          <div className="flex items-center gap-2 text-sm font-medium">
            <StatusIcon className={cn("h-4 w-4", status === "reconciling" && "animate-spin")} />
            {statusStyle.label}
          </div>
          <p className="mt-2 text-xs opacity-80">
            {unresolved.length === 0 ? "No unresolved relationship drift" : `${unresolved.length} unresolved issue${unresolved.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <MetricCard label="Stewarded entities" value={health?.stewarded_projects ?? 0} />
        <MetricCard label="Relationships checked" value={health?.relationships_checked ?? 0} />
        <MetricCard label="Last repair count" value={health?.relationships_repaired ?? 0} />
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock3 className="h-3.5 w-3.5" />
        Last completed: {formatTimestamp(health?.completed_at)} · Trigger: {health?.trigger ?? "none"}
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="border-b border-border bg-muted/40 px-4 py-3">
          <h3 className="text-sm font-medium">Relationship exceptions</h3>
        </div>
        {unresolved.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            No unresolved exceptions.
            {repaired.length > 0 && ` ${repaired.length} relationship issue${repaired.length === 1 ? " was" : "s were"} repaired during the last run.`}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {unresolved.map((issue, index) => (
              <li key={`${issue.project_id}-${issue.code}-${issue.user_email ?? index}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{issue.project_slug || "Tome settings"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{issue.message}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {issue.code.replaceAll("_", " ")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}
