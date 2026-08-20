"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  KeyRound,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  AutoIngestCredentialHealthSnapshot,
  AutoIngestCredentialStatus,
} from "@/lib/tome/auto-ingest/credential-health";

const STATUS: Record<
  AutoIngestCredentialStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  healthy: {
    label: "Healthy",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
    icon: CheckCircle2,
  },
  expiring: {
    label: "Expiring",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-600",
    icon: Clock3,
  },
  non_renewable: {
    label: "Manual token",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-600",
    icon: AlertTriangle,
  },
  pending: {
    label: "Pending",
    className: "border-muted-foreground/30 bg-muted text-muted-foreground",
    icon: Clock3,
  },
  no_sources: {
    label: "No sources",
    className: "border-muted-foreground/30 bg-muted text-muted-foreground",
    icon: Clock3,
  },
  expired: {
    label: "Expired",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: XCircle,
  },
  missing: {
    label: "Missing",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: XCircle,
  },
  no_owner: {
    label: "No owner",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: XCircle,
  },
  needs_reauth: {
    label: "Reconnect",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: XCircle,
  },
  refresh_failed: {
    label: "Refresh failed",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: XCircle,
  },
};

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatInterval(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  return minutes === 1 ? "every minute" : `every ${minutes} minutes`;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

export function AutoIngestCredentialHealthTab() {
  const [health, setHealth] = useState<AutoIngestCredentialHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refreshTokens = false) => {
    setError(null);
    if (refreshTokens) setRefreshing(true);
    try {
      const response = await fetch("/api/tome/admin/auto-ingest-credentials", {
        method: refreshTokens ? "POST" : "GET",
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to load token health");
      setHealth(body.health);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !health) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border p-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading auto-ingest token health…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-lg font-semibold">Auto-ingest credentials</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Tokens used by scheduled ingestion are checked and renewed {health ? formatInterval(health.refreshIntervalMs) : "in the background"}. Data stewards remain accountable; the credential owner is the person whose connection runs the job.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load(true)} disabled={refreshing}>
          {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Refresh now
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Auto-ingest projects" value={health?.summary.projects ?? 0} />
        <Metric label="Healthy connections" value={health?.summary.healthy ?? 0} />
        <Metric label="Need attention" value={health?.summary.attention ?? 0} />
        <Metric label="Missing setup" value={health?.summary.missing ?? 0} />
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="border-b bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            <h3 className="text-sm font-medium">People and provider tokens</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Token values are never shown or stored in this health report.
          </p>
        </div>
        {!health?.rows.length ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No projects have auto-ingest enabled.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b bg-muted/20 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium">Data steward</th>
                  <th className="px-4 py-3 font-medium">Credential owner</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Health</th>
                  <th className="px-4 py-3 font-medium">Expiry / last check</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {health.rows.map((row) => {
                  const status = STATUS[row.status];
                  const StatusIcon = status.icon;
                  return (
                    <tr key={`${row.projectId}:${row.provider ?? row.status}`} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.projectTitle}</p>
                        <p className="text-xs text-muted-foreground">{row.projectSlug}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{row.dataSteward}</p>
                        <p className="text-xs capitalize text-muted-foreground">{row.dataStewardType}</p>
                      </td>
                      <td className="px-4 py-3">
                        {row.credentialOwner ? (
                          <>
                            <p>{row.credentialOwner.name || row.credentialOwner.email}</p>
                            <p className="text-xs text-muted-foreground">{row.credentialOwner.email}</p>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Not configured</span>
                        )}
                      </td>
                      <td className="px-4 py-3 capitalize">{row.provider ?? "—"}</td>
                      <td className="max-w-xs px-4 py-3">
                        <Badge variant="outline" className={cn("gap-1", status.className)}>
                          <StatusIcon className="h-3 w-3" />
                          {status.label}
                        </Badge>
                        <p className="mt-1.5 text-xs text-muted-foreground">{row.detail}</p>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <p>Expires: {formatDate(row.expiresAt)}</p>
                        <p className="mt-1 text-muted-foreground">Checked: {formatDate(row.lastAttemptAt)}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
