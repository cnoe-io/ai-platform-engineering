"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, Lock, Play, Settings, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SaveButton } from "@/components/admin/SaveButton";
import type { IdpSyncRun, IdpSyncSettings } from "@/lib/rbac/mongo-collections";

interface IdpConnectorDescriptor {
  id: string;
  label: string;
  implemented: boolean;
}

interface IdpSyncHealth {
  ok: boolean;
  mode: string;
  error?: string;
}

interface IdpSyncStatus {
  provider: string;
  connectors: IdpConnectorDescriptor[];
  settings: IdpSyncSettings;
  recent_runs: IdpSyncRun[];
  provider_configured: boolean;
  health: IdpSyncHealth | null;
}

function formatDuration(startedAt: string, completedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function RunStatusBadge({ status }: { status: IdpSyncRun["status"] }) {
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
  { value: 60, label: "Every hour" },
  { value: 360, label: "Every 6 hours" },
  { value: 1440, label: "Every 24 hours" },
];

const SCHEDULE_PRESETS = [
  { key: "60", label: "Every hour" },
  { key: "360", label: "Every 6 hours" },
  { key: "1440", label: "Every 24 hours" },
  { key: "cron", label: "Custom (cron)" },
];

/** Mirror of the server-side validator in lib/rbac/cron.ts. */
const CRON_FIELD_BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function isValidCronField(field: string, min: number, max: number): boolean {
  if (!field) return false;
  if (field.includes(",")) return field.split(",").every((p) => isValidCronField(p, min, max));
  let base = field;
  if (field.includes("/")) {
    const [stepBase, step, ...rest] = field.split("/");
    if (rest.length > 0 || !/^\d+$/.test(step) || Number(step) <= 0) return false;
    base = stepBase;
  }
  if (base === "*") return true;
  if (base.includes("-")) {
    const [a, b, ...rest] = base.split("-");
    if (rest.length > 0 || !/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
    return Number(a) >= min && Number(b) <= max && Number(a) <= Number(b);
  }
  return /^\d+$/.test(base) && Number(base) >= min && Number(base) <= max;
}

function isValidCronExpr(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== CRON_FIELD_BOUNDS.length) return false;
  return fields.every((f, i) => isValidCronField(f, CRON_FIELD_BOUNDS[i][0], CRON_FIELD_BOUNDS[i][1]));
}

function scheduleSummary(settings: IdpSyncSettings): string {
  if (settings.schedule_mode === "cron") {
    return settings.sync_cron ? `cron: ${settings.sync_cron}` : "Custom (cron)";
  }
  const preset = INTERVAL_OPTIONS.find((o) => o.value === settings.sync_interval_minutes);
  return preset ? preset.label : `Every ${settings.sync_interval_minutes}m`;
}

const STATUS_BASE = "/api/admin/identity-group-sync/directory-sync";

interface IdentitySyncPanelProps {
  isAdmin: boolean;
}

export function IdentitySyncPanel({ isAdmin }: IdentitySyncPanelProps) {
  // Selected connector. Defaults to "okta" (the only implemented one today);
  // the status response returns the full connector registry for the selector.
  const [provider, setProvider] = useState("okta");
  const [connectors, setConnectors] = useState<IdpConnectorDescriptor[]>([
    { id: "okta", label: "Okta", implemented: true },
  ]);
  const connectorLabel = connectors.find((c) => c.id === provider)?.label ?? "Okta";

  const [status, setStatus] = useState<IdpSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);

  // Settings form state
  const [formEnabled, setFormEnabled] = useState(false);
  const [formScheduleMode, setFormScheduleMode] = useState<"interval" | "cron">("interval");
  const [formInterval, setFormInterval] = useState(60);
  const [formCron, setFormCron] = useState("0 * * * *");
  const [formGroupFilter, setFormGroupFilter] = useState("");
  const [formUserFilter, setFormUserFilter] = useState("");
  const [formDirty, setFormDirty] = useState(false);

  // "60" | "360" | "1440" | "cron": drives the preset selector.
  const scheduleSelection = formScheduleMode === "cron" ? "cron" : String(formInterval);
  const cronInvalid = formScheduleMode === "cron" && !isValidCronExpr(formCron);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${STATUS_BASE}/status?provider=${encodeURIComponent(provider)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to load sync status");
      setStatus(json.data);
      if (Array.isArray(json.data.connectors)) setConnectors(json.data.connectors);
      const s: IdpSyncSettings = json.data.settings;
      setFormEnabled(s.enabled);
      setFormScheduleMode(s.schedule_mode ?? "interval");
      setFormInterval(s.sync_interval_minutes);
      setFormCron(s.sync_cron ?? "0 * * * *");
      setFormGroupFilter(s.group_filter ?? "");
      setFormUserFilter(s.user_filter ?? "");
      setFormDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    setSaveResult(null);
    try {
      const res = await fetch(`${STATUS_BASE}/settings?provider=${encodeURIComponent(provider)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: formEnabled,
          schedule_mode: formScheduleMode,
          sync_interval_minutes: formInterval,
          sync_cron: formScheduleMode === "cron" ? formCron.trim() : undefined,
          group_filter: formGroupFilter || undefined,
          user_filter: formUserFilter || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to save settings");
      setFormDirty(false);
      setSaveResult("success");
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
      setSaveResult("error");
    } finally {
      setSaving(false);
    }
  };

  const triggerSync = async () => {
    setTriggering(true);
    setError(null);
    try {
      const res = await fetch(`${STATUS_BASE}/trigger?provider=${encodeURIComponent(provider)}`, {
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

  return (
    <div className="space-y-4">
      {/* Connector selector: one pill per registered IdP connector. Hidden
          when only one connector exists (no choice to make). New connectors
          appear here automatically once registered in idp-connectors.ts. */}
      {connectors.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Connector</span>
          {connectors.map((c) => {
            const active = c.id === provider;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setProvider(c.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              {error}
            </div>
          )}

          {/* Credential health: creds present but a live probe failed
              (bad token / expired key / missing scopes / network). */}
          {status?.provider_configured && status.health && !status.health.ok && (
            <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <span className="font-medium">{connectorLabel} credential check failed.</span>{" "}
                {status.health.error ?? "The configured credentials could not authenticate."}
              </div>
            </div>
          )}

          {/* Connector status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                {connectorLabel} Connector Status
              </CardTitle>
              <CardDescription>
                Background sync pulls groups and members directly from {connectorLabel} on a
                schedule, independent of user logins.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Credentials</div>
                  <div className="mt-1 font-medium text-sm">
                    {!status?.provider_configured ? (
                      <span className="text-amber-600">Not set</span>
                    ) : status.health?.ok === false ? (
                      <span className="text-red-600">Invalid</span>
                    ) : status.health?.ok ? (
                      <span className="text-green-600">
                        Verified{status.health.mode === "oauth" ? " (OAuth)" : ""}
                      </span>
                    ) : (
                      <span className="text-green-600">Configured</span>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Schedule</div>
                  <div className="mt-1 font-medium text-sm">
                    {status?.settings.enabled ? scheduleSummary(status.settings) : "Disabled"}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Last success</div>
                  <div className="mt-1 font-medium text-sm">
                    {lastSuccess ? new Date(lastSuccess.started_at).toLocaleString() : "Never"}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Last run status</div>
                  <div className="mt-1">
                    {lastRun ? (
                      <RunStatusBadge status={lastRun.status} />
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              </div>

              {!status?.provider_configured && (
                <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  <p>
                    Set <code className="font-mono text-xs">IDENTITY_SYNC_OKTA_ORG_URL</code> plus
                    credentials in one of these modes to enable the Okta connector:
                  </p>
                  <ul className="ml-4 list-disc space-y-1">
                    <li>
                      <span className="font-medium">API token:</span>{" "}
                      <code className="font-mono text-xs">IDENTITY_SYNC_OKTA_API_TOKEN</code>
                    </li>
                    <li>
                      <span className="font-medium">OAuth 2.0 (private-key JWT):</span>{" "}
                      <code className="font-mono text-xs">IDENTITY_SYNC_OKTA_OAUTH_CLIENT_ID</code>,{" "}
                      <code className="font-mono text-xs">IDENTITY_SYNC_OKTA_OAUTH_PRIVATE_KEY</code>
                      {" "}(and optional{" "}
                      <code className="font-mono text-xs">IDENTITY_SYNC_OKTA_OAUTH_KEY_ID</code>) with
                      scopes <code className="font-mono text-xs">okta.groups.read</code>{" "}
                      <code className="font-mono text-xs">okta.users.read</code>
                    </li>
                  </ul>
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
                Configure how often CAIPE syncs with {connectorLabel} and which groups/users to
                include.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  id="idp-sync-enabled"
                  type="checkbox"
                  checked={formEnabled}
                  onChange={(e) => {
                    setFormEnabled(e.target.checked);
                    setFormDirty(true);
                  }}
                  disabled={!isAdmin || !status?.provider_configured}
                  className="h-4 w-4 rounded border-input"
                />
                <label htmlFor="idp-sync-enabled" className="text-sm font-medium">
                  Enable background sync
                </label>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="idp-schedule">
                    Sync schedule
                  </label>
                  <select
                    id="idp-schedule"
                    value={scheduleSelection}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "cron") {
                        setFormScheduleMode("cron");
                      } else {
                        setFormScheduleMode("interval");
                        setFormInterval(Number(v));
                      }
                      setFormDirty(true);
                    }}
                    disabled={!isAdmin}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {SCHEDULE_PRESETS.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {formScheduleMode === "cron" && (
                    <div className="space-y-1">
                      <Input
                        id="idp-cron"
                        placeholder="0 */6 * * *"
                        value={formCron}
                        onChange={(e) => {
                          setFormCron(e.target.value);
                          setFormDirty(true);
                        }}
                        disabled={!isAdmin}
                        aria-invalid={cronInvalid}
                        className={cronInvalid ? "border-red-400 focus-visible:ring-red-400" : ""}
                      />
                      <p className={`text-xs ${cronInvalid ? "text-red-600" : "text-muted-foreground"}`}>
                        {cronInvalid
                          ? "Invalid cron: expected 5 fields (minute hour day-of-month month day-of-week)."
                          : "Standard 5-field cron (minute hour day-of-month month day-of-week)."}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="idp-group-filter">
                    Group filter
                  </label>
                  <Input
                    id="idp-group-filter"
                    placeholder='profile.department eq "engineering"'
                    value={formGroupFilter}
                    onChange={(e) => {
                      setFormGroupFilter(e.target.value);
                      setFormDirty(true);
                    }}
                    disabled={!isAdmin}
                  />
                  <p className="text-xs text-muted-foreground">
                    {connectorLabel} filter expression. Leave blank to sync all groups.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="idp-user-filter">
                    User filter
                  </label>
                  <Input
                    id="idp-user-filter"
                    placeholder='status eq "ACTIVE"'
                    value={formUserFilter}
                    onChange={(e) => {
                      setFormUserFilter(e.target.value);
                      setFormDirty(true);
                    }}
                    disabled={!isAdmin}
                  />
                  <p className="text-xs text-muted-foreground">
                    {connectorLabel} filter expression. Leave blank for all users.
                  </p>
                </div>
              </div>

              {isAdmin && (
                <div className="flex justify-end">
                  <SaveButton
                    onSave={saveSettings}
                    saving={saving}
                    dirty={formDirty}
                    disabled={cronInvalid}
                    result={saveResult}
                    ariaLabel={`Save ${connectorLabel} sync settings`}
                  />
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
                  Run a full {connectorLabel} sync immediately, regardless of the schedule.
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
                    Configure {connectorLabel} credentials to enable manual sync.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Run history */}
          <Card>
            <CardHeader>
              <CardTitle>Sync History</CardTitle>
              <CardDescription>Last 20 sync runs for {connectorLabel}</CardDescription>
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
                            {run.triggered_by === "manual" ? run.triggered_by_user ?? "manual" : "schedule"}
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
        </>
      )}
    </div>
  );
}
