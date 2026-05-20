"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, PlayCircle, RefreshCw, Shield } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type MigrationStatus = "not_started" | "planned" | "running" | "completed" | "failed" | "skipped";
const KEYCLOAK_MIGRATION_ID = "keycloak_rbac_mapping_reconciliation_v1";
const KEYCLOAK_MIGRATION_CONFIRMATION = "MIGRATE keycloak_rbac_mappings TO v1";

interface MetricDetails {
  title: string;
  description: string;
  rows: Array<Record<string, unknown>>;
}

interface KeycloakMigrationHealth {
  keycloak: {
    configured: boolean;
    reachable: boolean;
    realm: string;
    last_probe_at: string;
    probe_error?: string;
  };
  schema_area: {
    area: string;
    current_version: number | null;
    target_version: number;
    status: "current" | "behind" | "unknown";
    last_migration_id?: string;
  };
  migration: {
    id: string;
    manifest_status: MigrationStatus;
    last_run?: {
      status: MigrationStatus;
      actor?: string;
      completed_at?: string;
      updated_at?: string;
      applied_counts: Record<string, number>;
      planned_counts: Record<string, number>;
      warnings: string[];
      error?: string;
    };
  };
  blocking: {
    is_blocking: boolean;
    blocking_required_count: number;
  };
  keycloak_values?: {
    team_scopes?: Array<Record<string, unknown>>;
    obo_permissions?: Array<Record<string, unknown>>;
    bot_service_accounts?: Array<Record<string, unknown>>;
    token_exchange_permissions?: Array<Record<string, unknown>>;
    active_team_defaults?: Array<Record<string, unknown>>;
  };
  keycloak_values_error?: string;
}

interface KeycloakMigrationHealthPanelProps {
  compact?: boolean;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { data?: T; error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return body.data as T;
}

function statusTone(status: MigrationStatus | "current" | "behind" | "unknown") {
  if (status === "completed" || status === "current") return "text-emerald-600";
  if (status === "failed" || status === "behind") return "text-red-600";
  if (status === "running" || status === "planned") return "text-amber-600";
  return "text-muted-foreground";
}

function statusColorClass(status: MigrationStatus | "current" | "behind" | "unknown") {
  if (status === "completed" || status === "current") {
    return "border-emerald-300 bg-emerald-50 text-emerald-700";
  }
  if (status === "failed") {
    return "border-red-300 bg-red-50 text-red-700";
  }
  if (status === "behind" || status === "running" || status === "planned") {
    return "border-amber-300 bg-amber-50 text-amber-700";
  }
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function formatVersion(version: number | null): string {
  return typeof version === "number" ? `v${version}` : "unknown";
}

function formatVersionRange(current: number | null, target: number): string {
  return `${formatVersion(current)} -> ${formatVersion(target)}`;
}

function HealthCheck({
  label,
  state,
}: {
  label: string;
  state: "ok" | "warning" | "error";
}) {
  const Icon = state === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        state === "ok" && "border-emerald-300 bg-emerald-50 text-emerald-700",
        state === "warning" && "border-amber-300 bg-amber-50 text-amber-700",
        state === "error" && "border-red-300 bg-red-50 text-red-700",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function rowsForAppliedCount(
  key: string,
  value: number,
  health: KeycloakMigrationHealth,
): Array<Record<string, unknown>> {
  if (key === "team_scopes_reconciled") return health.keycloak_values?.team_scopes ?? [];
  if (key === "obo_permission_sets_reconciled") return health.keycloak_values?.obo_permissions ?? [];
  if (key === "bot_service_accounts_reconciled") return health.keycloak_values?.bot_service_accounts ?? [];
  if (key === "token_exchange_permissions_reconciled") {
    return health.keycloak_values?.token_exchange_permissions ?? [];
  }
  if (key === "active_team_defaults_selected") return health.keycloak_values?.active_team_defaults ?? [];
  return [{ count_name: key, count_value: value }];
}

function displayText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\bobo\b/gi, "OBO")
    .replace(/\bid\b/gi, "ID")
    .replace(/^\w/, (match) => match.toUpperCase());
}

function rowColumns(rows: Array<Record<string, unknown>>): string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key);
  }
  return [...columns];
}

function ValueDisplay({ value }: { value: unknown }) {
  if (typeof value === "boolean") {
    return (
      <Badge variant={value ? "secondary" : "outline"} className="w-fit">
        {value ? "Yes" : "No"}
      </Badge>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">None</span>;
    return (
      <div className="flex flex-wrap gap-1.5">
        {value.map((item, index) => (
          <Badge
            key={`${displayText(item)}-${index}`}
            variant="outline"
            className="max-w-full whitespace-normal break-all text-left font-mono text-[11px]"
          >
            {displayText(item)}
          </Badge>
        ))}
      </div>
    );
  }
  const text = displayText(value);
  const monospaced = /(^[a-z0-9][a-z0-9-]*$)|(_|-)|([0-9a-f]{8,})/i.test(text);
  return (
    <span
      className={cn(
        "min-w-0 break-words",
        monospaced && "rounded bg-muted px-1.5 py-1 font-mono text-[11px]",
      )}
    >
      {text}
    </span>
  );
}

export function KeycloakMigrationHealthPanel({ compact = false }: KeycloakMigrationHealthPanelProps) {
  const [health, setHealth] = useState<KeycloakMigrationHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<MetricDetails | null>(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHealth(
        await readJson<KeycloakMigrationHealth>(
          await fetch("/api/admin/keycloak/migration-health"),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Keycloak migration health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const reconcileNow = useCallback(async () => {
    setReconciling(true);
    setError(null);
    setReconcileMessage(null);
    try {
      const result = await readJson<{ applied_counts?: Record<string, number> }>(
        await fetch(`/api/admin/rebac/migrations/${KEYCLOAK_MIGRATION_ID}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation: KEYCLOAK_MIGRATION_CONFIRMATION }),
        }),
      );
      const appliedCount = Object.values(result.applied_counts ?? {}).reduce((sum, value) => sum + value, 0);
      setReconcileMessage(`Reconcile applied${appliedCount ? ` (${appliedCount} updates)` : ""}.`);
      await loadHealth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reconcile Keycloak migration");
    } finally {
      setReconciling(false);
    }
  }, [loadHealth]);

  const lastRun = health?.migration.last_run;
  const counts = useMemo(() => Object.entries(lastRun?.applied_counts ?? {}), [lastRun]);
  const degraded = Boolean(error || health?.blocking.is_blocking || health?.migration.manifest_status === "failed" || !health?.keycloak.reachable);
  const canReconcile = Boolean(
    health &&
      !compact &&
      health.keycloak.configured &&
      (health.blocking.is_blocking ||
        health.schema_area.status !== "current" ||
        health.migration.manifest_status === "failed"),
  );
  const Icon = degraded ? AlertTriangle : CheckCircle2;
  const healthContext = health
    ? {
        migration_id: health.migration.id,
        migration_status: health.migration.manifest_status,
        schema_area: health.schema_area.area,
        last_run: health.migration.last_run,
      }
    : {};
  const schemaHealthState =
    health?.schema_area.status === "current"
      ? "ok"
      : health?.schema_area.status === "behind"
        ? "warning"
        : "error";

  return (
    <Card className={cn(degraded && "border-amber-400/60")}>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            Keycloak Reconciliation Health
          </CardTitle>
          <CardDescription>
            The app automatically keeps Keycloak team access in sync. First-time bootstrap setup is handled separately.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {canReconcile && (
            <Button type="button" size="sm" onClick={reconcileNow} disabled={reconciling || loading}>
              {reconciling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
              Reconcile now
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={loadHealth} disabled={loading || reconciling}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {reconcileMessage && (
          <div className="rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-900">
            {reconcileMessage}
          </div>
        )}
        {!health && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading Keycloak migration health...
          </div>
        )}
        {health && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Icon className={cn("h-4 w-4", degraded ? "text-amber-600" : "text-emerald-600")} />
              <span className="font-medium">Realm {health.keycloak.realm}</span>
              <HealthCheck
                label={health.keycloak.configured ? "Keycloak URL configured" : "Keycloak URL missing"}
                state={health.keycloak.configured ? "ok" : "error"}
              />
              <HealthCheck
                label={health.keycloak.reachable ? "Keycloak reachable" : "Keycloak unreachable"}
                state={health.keycloak.reachable ? "ok" : "error"}
              />
              <HealthCheck
                label={`Schema ${health.schema_area.status}`}
                state={schemaHealthState}
              />
            </div>

            <div className={cn("grid gap-2", compact ? "sm:grid-cols-2" : "sm:grid-cols-4")}>
              <Metric
                label="Schema area"
                value={health.schema_area.area}
                details={{
                  title: "Schema area details",
                  description: "Mongo schema-version state for the Keycloak reconciliation area.",
                  rows: [{ ...healthContext, ...health.schema_area }],
                }}
                onInspect={setSelectedMetric}
              />
              <Metric
                label="Version"
                value={formatVersionRange(health.schema_area.current_version, health.schema_area.target_version)}
                details={{
                  title: "Version details",
                  description: "Runtime target version compared to the persisted Mongo schema version.",
                  rows: [{
                    ...healthContext,
                    current_version: formatVersion(health.schema_area.current_version),
                    target_version: formatVersion(health.schema_area.target_version),
                    status: health.schema_area.status,
                  }],
                }}
                onInspect={setSelectedMetric}
              />
              <Metric
                label="Migration status"
                value={health.migration.manifest_status.replace(/_/g, " ")}
                tone={statusTone(health.migration.manifest_status)}
                details={{
                  title: "Migration status details",
                  description: "Last persisted migration run and status metadata.",
                  rows: [{
                    ...healthContext,
                    last_run_status: health.migration.last_run?.status ?? "not_started",
                    completed_at: health.migration.last_run?.completed_at,
                    updated_at: health.migration.last_run?.updated_at,
                    error: health.migration.last_run?.error,
                  }],
                }}
                onInspect={setSelectedMetric}
              />
              <Metric
                label="Last actor"
                value={lastRun?.actor ?? "none"}
                details={{
                  title: "Last actor details",
                  description: "The actor that last updated the Keycloak migration record.",
                  rows: [{ ...healthContext, actor: lastRun?.actor ?? null }],
                }}
                onInspect={setSelectedMetric}
              />
            </div>

            {!compact && counts.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {counts.map(([key, value]) => (
                  <Metric
                    key={key}
                    label={humanizeKey(key)}
                    value={String(value)}
                    details={{
                      title: `${humanizeKey(key)} details`,
                      description: "Actual Keycloak values behind this reconciliation count.",
                      rows: rowsForAppliedCount(key, value, health),
                    }}
                    onInspect={setSelectedMetric}
                  />
                ))}
              </div>
            )}

            {(lastRun?.error || health.keycloak.probe_error) && (
              <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900">
                {lastRun?.error ?? health.keycloak.probe_error}
              </div>
            )}
            {!compact && lastRun?.warnings && lastRun.warnings.length > 0 && (
              <div className="space-y-1 rounded-lg border p-3 text-sm">
                <div className="font-medium">Warnings</div>
                {lastRun.warnings.map((warning) => (
                  <div key={warning} className="text-muted-foreground">
                    {warning}
                  </div>
                ))}
              </div>
            )}
            {!compact && health.keycloak_values_error && (
              <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900">
                Keycloak value inspection failed: {health.keycloak_values_error}
              </div>
            )}
          </>
        )}
      </CardContent>
      <Dialog open={selectedMetric !== null} onOpenChange={(open) => !open && setSelectedMetric(null)}>
        <DialogContent
          className="flex max-h-[88vh] w-[calc(100vw-2rem)] flex-col overflow-hidden"
          style={{ maxWidth: "min(960px, calc(100vw - 2rem))" }}
        >
          <DialogHeader className="min-w-0 pr-8">
            <DialogTitle>{selectedMetric?.title}</DialogTitle>
            <DialogDescription>{selectedMetric?.description}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Keycloak values</div>
              <Badge variant="outline">
                {selectedMetric?.rows.length ?? 0} {(selectedMetric?.rows.length ?? 0) === 1 ? "row" : "rows"}
              </Badge>
            </div>
            <div
              data-testid="keycloak-values-scroll"
              className="max-h-[62vh] min-w-0 space-y-3 overflow-auto pr-1"
            >
              {(selectedMetric?.rows.length ?? 0) > 0 ? (
                (selectedMetric?.rows ?? []).map((row, index) => (
                  <div
                    key={`${selectedMetric?.title ?? "metric"}-${index}`}
                    className="min-w-0 rounded-xl border bg-muted/20 p-4"
                  >
                    <div className="mb-3 text-xs font-medium text-muted-foreground">
                      Result {index + 1}
                    </div>
                    <dl className="grid min-w-0 gap-3 md:grid-cols-2">
                      {rowColumns([row]).map((column) => (
                        <div key={column} className="min-w-0 space-y-1 rounded-lg bg-background/70 p-3">
                          <dt className="text-xs font-medium text-muted-foreground">{humanizeKey(column)}</dt>
                          <dd className="min-w-0 text-sm">
                            <ValueDisplay value={row[column]} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))
              ) : (
                <div className="p-4 text-sm text-muted-foreground">
                  No Keycloak values were returned for this metric.
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
  details,
  onInspect,
}: {
  label: string;
  value: string;
  tone?: string;
  details?: MetricDetails;
  onInspect?: (details: MetricDetails) => void;
}) {
  const content = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("break-words font-medium", tone)}>{value}</div>
    </>
  );
  if (details && onInspect) {
    return (
      <button
        type="button"
        aria-label={`Inspect ${label} metric`}
        className="rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onInspect(details)}
      >
        {content}
      </button>
    );
  }
  return (
    <div className="rounded-lg border p-3 text-sm">
      {content}
    </div>
  );
}
