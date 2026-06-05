"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, Lock, Play, RefreshCw, Settings, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { OktaSyncRun, OktaSyncSettings } from "@/lib/rbac/mongo-collections";

interface OktaSyncStatus {
  settings: OktaSyncSettings;
  recent_runs: OktaSyncRun[];
  provider_configured: boolean;
}

function formatDuration(startedAt: string, completedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function RunStatusBadge({ status }: { status: OktaSyncRun["status"] }) {
  if (status === "success")
    return (
      <Badge variant="status" className="gap-1 text-xs">
        <CheckCircle2 className="h-3 w-3" />
        Success
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="destructive" className="gap-1 text-xs">
        <XCircle className="h-3 w-3" />
        Failed
      </Badge>
    );
  if (status === "running")
    return (
      <Badge variant="outline" className="gap-1 text-xs text-amber-600 border-amber-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        Running
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-xs text-orange-600 border-orange-400">
      <Clock className="h-3 w-3" />
      Partial
    </Badge>
  );
}

const INTERVAL_OPTIONS = [
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every hour" },
  { value: 120, label: "Every 2 hours" },
  { value: 360, label: "Every 6 hours" },
];

interface OktaSyncPanelProps {
  isAdmin: boolean;
}

export function OktaSyncPanel({ isAdmin }: OktaSyncPanelProps) {
  const [status, setStatus] = useState<OktaSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [saving, setSaving] = useState(false);

  // Settings form state
  const [formEnabled, setFormEnabled] = useState(false);
  const [formInterval, setFormInterval] = useState(60);
  const [formGroupFilter, setFormGroupFilter] = useState("");
  const [formUserFilter, setFormUserFilter] = useState("");
  const [formChunkSize, setFormChunkSize] = useState(250);
  const [formDirty, setFormDirty] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/identity-group-sync/okta-sync/status");
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to load Okta sync status");
      setStatus(json.data);
      const s: OktaSyncSettings = json.data.settings;
      setFormEnabled(s.enabled);
      setFormInterval(s.sync_interval_minutes);
      setFormGroupFilter(s.group_filter ?? "");
      setFormUserFilter(s.user_filter ?? "");
      setFormChunkSize(s.chunk_size);
      setFormDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/identity-group-sync/okta-sync/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: formEnabled,
          sync_interval_minutes: formInterval,
          group_filter: formGroupFilter || undefined,
          user_filter: formUserFilter || undefined,
          chunk_size: formChunkSize,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to save settings");
      setFormDirty(false);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const triggerSync = async () => {
    setTriggering(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/identity-group-sync/okta-sync/trigger", {
        method: "POST",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Sync failed");
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync trigger failed");
    } finally {
      setTriggering(false);
    }
  };

  const lastRun = status?.recent_runs?.[0];
  const lastSuccess = status?.recent_runs?.find((r) => r.status === "success");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {/* Provider status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                Okta Connector Status
              </CardTitle>
              <CardDescription>
                Background sync pulls groups and members directly from Okta on a schedule,
                independent of user logins.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadStatus} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Credentials</div>
              <div className="mt-1 font-medium text-sm">
                {status?.provider_configured ? (
                  <span className="text-green-600">Configured</span>
                ) : (
                  <span className="text-amber-600">Not set</span>
                )}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Schedule</div>
              <div className="mt-1 font-medium text-sm">
                {status?.settings.enabled
                  ? `Every ${status.settings.sync_interval_minutes}m`
                  : "Disabled"}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Last success</div>
              <div className="mt-1 font-medium text-sm">
                {lastSuccess
                  ? new Date(lastSuccess.started_at).toLocaleString()
                  : "Never"}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Last run status</div>
              <div className="mt-1">
                {lastRun ? <RunStatusBadge status={lastRun.status} /> : <span className="text-sm text-muted-foreground">—</span>}
              </div>
            </div>
          </div>

          {!status?.provider_configured && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              Set <code className="font-mono text-xs">IDENTITY_SYNC_OKTA_ORG_URL</code> and{" "}
              <code className="font-mono text-xs">IDENTITY_SYNC_OKTA_API_TOKEN</code> to enable
              the Okta connector.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Sync Settings
          </CardTitle>
          <CardDescription>
            Configure how often CAIPE syncs with Okta and which groups/users to include.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              id="okta-sync-enabled"
              type="checkbox"
              checked={formEnabled}
              onChange={(e) => { setFormEnabled(e.target.checked); setFormDirty(true); }}
              disabled={!isAdmin || !status?.provider_configured}
              className="h-4 w-4 rounded border-input"
            />
            <label htmlFor="okta-sync-enabled" className="text-sm font-medium">
              Enable background sync
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="okta-interval">
                Sync interval
              </label>
              <select
                id="okta-interval"
                value={formInterval}
                onChange={(e) => { setFormInterval(Number(e.target.value)); setFormDirty(true); }}
                disabled={!isAdmin}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="okta-chunk-size">
                Chunk size
              </label>
              <Input
                id="okta-chunk-size"
                type="number"
                min={10}
                max={1000}
                value={formChunkSize}
                onChange={(e) => { setFormChunkSize(Number(e.target.value)); setFormDirty(true); }}
                disabled={!isAdmin}
              />
              <p className="text-xs text-muted-foreground">Members resolved per API call (default 250)</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="okta-group-filter">
                Group filter
              </label>
              <Input
                id="okta-group-filter"
                placeholder='profile.department eq "engineering"'
                value={formGroupFilter}
                onChange={(e) => { setFormGroupFilter(e.target.value); setFormDirty(true); }}
                disabled={!isAdmin}
              />
              <p className="text-xs text-muted-foreground">Okta filter expression — leave blank to sync all groups</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="okta-user-filter">
                User filter
              </label>
              <Input
                id="okta-user-filter"
                placeholder='status eq "ACTIVE"'
                value={formUserFilter}
                onChange={(e) => { setFormUserFilter(e.target.value); setFormDirty(true); }}
                disabled={!isAdmin}
              />
              <p className="text-xs text-muted-foreground">Okta filter expression — leave blank for all users</p>
            </div>
          </div>

          {isAdmin && (
            <div className="flex justify-end">
              <Button onClick={saveSettings} disabled={saving || !formDirty} size="sm">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save settings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual trigger */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-4 w-4 text-muted-foreground" />
              Manual Sync
            </CardTitle>
            <CardDescription>
              Run a full Okta sync immediately, regardless of the schedule.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={triggerSync}
              disabled={triggering || !status?.provider_configured}
              variant="outline"
            >
              {triggering ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {triggering ? "Syncing…" : "Run sync now"}
            </Button>
            {!status?.provider_configured && (
              <p className="mt-2 text-xs text-muted-foreground">
                Configure Okta credentials to enable manual sync.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Run history */}
      <Card>
        <CardHeader>
          <CardTitle>Sync History</CardTitle>
          <CardDescription>Last 20 sync runs</CardDescription>
        </CardHeader>
        <CardContent>
          {!status?.recent_runs?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No sync runs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="pb-2 text-left font-medium">Status</th>
                    <th className="pb-2 text-left font-medium">Started</th>
                    <th className="pb-2 text-left font-medium">Duration</th>
                    <th className="pb-2 text-left font-medium">Triggered by</th>
                    <th className="pb-2 text-right font-medium">Groups</th>
                    <th className="pb-2 text-right font-medium">Added</th>
                    <th className="pb-2 text-right font-medium">Removed</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {status.recent_runs.map((run) => (
                    <tr key={run.id} className="hover:bg-muted/30">
                      <td className="py-2 pr-4">
                        <RunStatusBadge status={run.status} />
                        {run.error_message && (
                          <p className="mt-0.5 text-xs text-red-600 max-w-xs truncate" title={run.error_message}>
                            {run.error_message}
                          </p>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {new Date(run.started_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {formatDuration(run.started_at, run.completed_at)}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {run.triggered_by === "manual"
                          ? run.triggered_by_user ?? "manual"
                          : "schedule"}
                      </td>
                      <td className="py-2 pr-4 text-right">{run.groups_fetched ?? "—"}</td>
                      <td className="py-2 pr-4 text-right text-green-700">{run.membership_sources_added ?? "—"}</td>
                      <td className="py-2 text-right text-red-700">{run.membership_sources_removed ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
