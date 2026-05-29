"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Database,
  Download,
  Loader2,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type MigrationKind = "implicit" | "explicit" | "index";
type MigrationStatus = "not_started" | "planned" | "running" | "completed" | "failed";

interface MigrationListItem {
  id: string;
  title: string;
  description: string;
  kind: MigrationKind;
  schema_area: string;
  current_version: number | null;
  target_version: number;
  status: MigrationStatus;
  implemented: boolean;
  required: boolean;
  confirmation: string;
}

interface MigrationSchemaVersion {
  schema_area: string;
  current_version: number | null;
  target_version: number | null;
  status: "current" | "behind" | "unknown";
}

interface MigrationRuntime {
  migration_release: string;
  manifest_count: number;
}

interface MigrationListResponse {
  release: string;
  runtime: MigrationRuntime;
  schema_versions: MigrationSchemaVersion[];
  migrations: MigrationListItem[];
  completed_migrations: MigrationListItem[];
}

interface MigrationBlockingStatus {
  pending_required_count: number;
  blocking_required_count: number;
  version_bootstrap_required_count?: number;
  version_bootstrap_schema_areas?: string[];
  needs_version_bootstrap?: boolean;
  requires_attention?: boolean;
  is_blocking: boolean;
  override_active: boolean;
  override_reason?: string;
}

interface MigrationPlan {
  migration_id: string;
  confirmation: string;
  counts: Record<string, number>;
  warnings: string[];
  sample_diffs: Array<{
    collection: string;
    id: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }>;
}

interface MigrationApplyResult {
  applied_counts: Record<string, number>;
}

interface BulkMigrationApplyResult {
  applied_count: number;
  results: Array<{
    migration_id: string;
    title: string;
    applied_counts: Record<string, number>;
  }>;
}

interface SchemaVersionBootstrapApplyResult {
  migration_id: string;
  schema_areas: string[];
  applied_counts: Record<string, number>;
}

interface MigrationTabProps {
  isAdmin: boolean;
}

const SCHEMA_VERSION_BOOTSTRAP_CONFIRMATION = "INITIALIZE SCHEMA VERSIONS TO v1";
const BULK_MIGRATION_CONFIRMATION = "APPLY SELECTED MIGRATIONS";

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { data?: T; error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return body.data as T;
}

function kindTone(kind: MigrationKind): "default" | "secondary" | "outline" {
  if (kind === "implicit") return "secondary";
  if (kind === "index") return "outline";
  return "default";
}

function formatVersion(version: number | null): string {
  return typeof version === "number" ? `v${version}` : "unknown";
}

function formatVersionRange(current: number | null, target: number | null): string {
  if (target === null) return formatVersion(current);
  return `${formatVersion(current)} -> ${formatVersion(target)}`;
}

function statusColorClass(status: MigrationStatus | MigrationSchemaVersion["status"]): string {
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

function schemaVersionNeedsMigration(schema: MigrationSchemaVersion): boolean {
  return (
    schema.target_version !== null &&
    (schema.current_version === null || schema.current_version < schema.target_version)
  );
}

function schemaStatusIconClass(status: MigrationSchemaVersion["status"], needsMigration = false): string {
  if (needsMigration) return "text-amber-600";
  if (status === "current") return "text-emerald-600";
  if (status === "behind") return "text-amber-600";
  return "text-slate-500";
}

export function MigrationTab({ isAdmin }: MigrationTabProps) {
  const [release, setRelease] = useState("0.5.1");
  const [runtime, setRuntime] = useState<MigrationRuntime | null>(null);
  const [schemaVersions, setSchemaVersions] = useState<MigrationSchemaVersion[]>([]);
  const [migrations, setMigrations] = useState<MigrationListItem[]>([]);
  const [completedMigrations, setCompletedMigrations] = useState<MigrationListItem[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showAllSchemaVersions, setShowAllSchemaVersions] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBulkMigrationIds, setSelectedBulkMigrationIds] = useState<string[]>([]);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [bulkPlans, setBulkPlans] = useState<MigrationPlan[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [bulkConfirmation, setBulkConfirmation] = useState("");
  const [copiedConfirmation, setCopiedConfirmation] = useState(false);
  const [copiedBulkConfirmation, setCopiedBulkConfirmation] = useState(false);
  const [applyResult, setApplyResult] = useState<MigrationApplyResult | null>(null);
  const [bulkApplyResult, setBulkApplyResult] = useState<BulkMigrationApplyResult | null>(null);
  const [versionBootstrapResult, setVersionBootstrapResult] = useState<SchemaVersionBootstrapApplyResult | null>(null);
  const [blockingStatus, setBlockingStatus] = useState<MigrationBlockingStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [bulkPlanning, setBulkPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [versionBootstrapApplying, setVersionBootstrapApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleMigrations = useMemo(
    () => (showCompleted ? [...migrations, ...completedMigrations] : migrations),
    [completedMigrations, migrations, showCompleted],
  );

  const schemaVersionsNeedingMigration = useMemo(
    () => schemaVersions.filter(schemaVersionNeedsMigration),
    [schemaVersions],
  );

  const visibleSchemaVersions = showAllSchemaVersions ? schemaVersions : schemaVersionsNeedingMigration;
  const hiddenSchemaVersionCount = schemaVersions.length - schemaVersionsNeedingMigration.length;
  const unversionedSchemaAreaNames = useMemo(
    () => schemaVersions.filter((schema) => schema.current_version === null).map((schema) => schema.schema_area),
    [schemaVersions],
  );

  const selectedMigration = useMemo(
    () => visibleMigrations.find((migration) => migration.id === selectedId) ?? visibleMigrations[0] ?? null,
    [selectedId, visibleMigrations],
  );

  const selectableBulkMigrations = useMemo(
    () => migrations.filter((migration) => migration.implemented && migration.status !== "completed"),
    [migrations],
  );
  const selectedBulkMigrationIdSet = useMemo(
    () => new Set(selectedBulkMigrationIds),
    [selectedBulkMigrationIds],
  );
  const selectedBulkMigrations = useMemo(
    () => selectableBulkMigrations.filter((migration) => selectedBulkMigrationIdSet.has(migration.id)),
    [selectableBulkMigrations, selectedBulkMigrationIdSet],
  );
  const allPendingMigrationsSelected =
    selectableBulkMigrations.length > 0 && selectedBulkMigrations.length === selectableBulkMigrations.length;

  const loadMigrations = useCallback(async (options: { keepSelection?: boolean } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const [data, status] = await Promise.all([
        fetch("/api/admin/rebac/migrations").then((response) => readJson<MigrationListResponse>(response)),
        fetch("/api/admin/rebac/migrations/status")
          .then((response) => readJson<MigrationBlockingStatus>(response))
          .catch(() => null),
      ]);
      setRelease(data.release);
      setRuntime(data.runtime);
      setSchemaVersions(data.schema_versions ?? []);
      setMigrations(data.migrations);
      setCompletedMigrations(data.completed_migrations ?? []);
      setBlockingStatus(status);
      setSelectedBulkMigrationIds((current) => {
        const selectableIds = new Set(
          data.migrations
            .filter((migration) => migration.implemented && migration.status !== "completed")
            .map((migration) => migration.id),
        );
        return current.filter((migrationId) => selectableIds.has(migrationId));
      });
      setSelectedId((current) => {
        const selectable = [...data.migrations, ...(data.completed_migrations ?? [])];
        if (options.keepSelection && current && selectable.some((migration) => migration.id === current)) {
          return current;
        }
        return data.migrations[0]?.id ?? null;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    loadMigrations()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load migrations");
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, loadMigrations]);

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Admin access required
          </CardTitle>
          <CardDescription>Schema migrations can change persisted data and require administrator access.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  async function runPlan(migration: MigrationListItem) {
    setSelectedId(migration.id);
    setPlan(null);
    setApplyResult(null);
    setConfirmation("");
    setCopiedConfirmation(false);
    setError(null);
    setPlanning(true);
    try {
      const data = await readJson<MigrationPlan>(
        await fetch(`/api/admin/rebac/migrations/${migration.id}/plan`, { method: "POST" }),
      );
      setPlan(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to plan migration");
    } finally {
      setPlanning(false);
    }
  }

  function resetBulkPreview() {
    setBulkPlans([]);
    setBulkApplyResult(null);
    setBulkConfirmation("");
    setCopiedBulkConfirmation(false);
  }

  function toggleBulkMigration(migrationId: string, checked: boolean) {
    resetBulkPreview();
    setSelectedBulkMigrationIds((current) => {
      if (checked) return Array.from(new Set([...current, migrationId]));
      return current.filter((id) => id !== migrationId);
    });
  }

  function toggleAllPendingMigrations(checked: boolean) {
    if (!checked) {
      resetBulkPreview();
      setSelectedBulkMigrationIds([]);
      return;
    }

    const nextSelection = selectableBulkMigrations;
    setSelectedBulkMigrationIds(nextSelection.map((migration) => migration.id));
    void runBulkPlanFor(nextSelection);
  }

  async function runBulkPlanFor(migrationsToPlan: MigrationListItem[]) {
    if (migrationsToPlan.length === 0) return;
    setError(null);
    resetBulkPreview();
    setBulkPlanning(true);
    try {
      const plans = await Promise.all(
        migrationsToPlan.map((migration) =>
          fetch(`/api/admin/rebac/migrations/${migration.id}/plan`, { method: "POST" }).then((response) =>
            readJson<MigrationPlan>(response),
          ),
        ),
      );
      setBulkPlans(plans);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to plan selected migrations");
    } finally {
      setBulkPlanning(false);
    }
  }

  async function runBulkPlan() {
    await runBulkPlanFor(selectedBulkMigrations);
  }

  async function applySelectedMigration() {
    if (!selectedMigration) return;
    setError(null);
    setApplying(true);
    try {
      const data = await readJson<MigrationApplyResult>(
        await fetch(`/api/admin/rebac/migrations/${selectedMigration.id}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation }),
        }),
      );
      setApplyResult(data);
      await loadMigrations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply migration");
    } finally {
      setApplying(false);
    }
  }

  async function applySchemaVersionBootstrap(schemaAreas: string[]) {
    if (schemaAreas.length === 0) return null;
    setError(null);
    setVersionBootstrapResult(null);
    setVersionBootstrapApplying(true);
    try {
      const data = await readJson<SchemaVersionBootstrapApplyResult>(
        await fetch("/api/admin/rebac/migrations/version-bootstrap/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_areas: schemaAreas,
            confirmation: SCHEMA_VERSION_BOOTSTRAP_CONFIRMATION,
          }),
        }),
      );
      setVersionBootstrapResult(data);
      return data;
    } finally {
      setVersionBootstrapApplying(false);
    }
  }

  async function applySelectedVersionBootstrap() {
    try {
      await applySchemaVersionBootstrap(unversionedSchemaAreaNames);
      await loadMigrations({ keepSelection: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize schema versions");
    }
  }

  const canApply = Boolean(plan && selectedMigration && confirmation === selectedMigration.confirmation && !applying);
  const canApplySelectedMigrations = Boolean(
    selectedBulkMigrations.length > 0 &&
      bulkPlans.length === selectedBulkMigrations.length &&
      bulkConfirmation === BULK_MIGRATION_CONFIRMATION &&
      !bulkApplying,
  );

  async function applySelectedMigrations() {
    if (!canApplySelectedMigrations) return;
    setError(null);
    setBulkApplying(true);
    const results: BulkMigrationApplyResult["results"] = [];
    let failedStep = "schema version metadata";
    try {
      await applySchemaVersionBootstrap(unversionedSchemaAreaNames);
      for (const migration of selectedBulkMigrations) {
        failedStep = migration.title;
        const data = await readJson<MigrationApplyResult>(
          await fetch(`/api/admin/rebac/migrations/${migration.id}/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmation: migration.confirmation }),
          }),
        );
        results.push({
          migration_id: migration.id,
          title: migration.title,
          applied_counts: data.applied_counts,
        });
      }
      setBulkApplyResult({ applied_count: results.length, results });
      setSelectedBulkMigrationIds([]);
      setBulkPlans([]);
      setBulkConfirmation("");
      setCopiedBulkConfirmation(false);
      await loadMigrations({ keepSelection: true });
    } catch (err) {
      const failedMigration = selectedBulkMigrations[results.length];
      const message = err instanceof Error ? err.message : "Failed to apply selected migrations";
      setBulkApplyResult(results.length > 0 ? { applied_count: results.length, results } : null);
      setError(failedMigration ? `Failed applying ${failedStep}: ${message}` : message);
    } finally {
      setBulkApplying(false);
    }
  }

  async function copyConfirmationText() {
    if (!plan) return;
    await navigator.clipboard?.writeText(plan.confirmation);
    setCopiedConfirmation(true);
  }

  async function copyBulkConfirmationText() {
    await navigator.clipboard?.writeText(BULK_MIGRATION_CONFIRMATION);
    setCopiedBulkConfirmation(true);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              {release} Schema Migrations
            </CardTitle>
            <CardDescription>
              Preview and apply schema-versioned migrations for the release. Private conversation ownership stays implicit;
              shared/resource access is reconciled through explicit ReBAC migrations.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setPlan(null);
              setApplyResult(null);
              setConfirmation("");
              setCopiedConfirmation(false);
              resetBulkPreview();
              loadMigrations({ keepSelection: true }).catch((err) =>
                setError(err instanceof Error ? err.message : "Failed to refresh migrations"),
              );
            }}
            disabled={loading}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh migrations
          </Button>
        </CardHeader>
      </Card>

      {blockingStatus?.override_active && (
        <Card className="border-amber-300/60 bg-amber-50">
          <CardContent className="flex items-center gap-2 pt-6 text-sm text-amber-900">
            <ShieldAlert className="h-4 w-4" />
            Migration override active{blockingStatus.override_reason ? `: ${blockingStatus.override_reason}` : ""}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Runtime and DB Versions</CardTitle>
            <CardDescription>
              Runtime migration release: {runtime?.migration_release ?? release}. DB schema areas are versioned independently.
            </CardDescription>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showAllSchemaVersions}
              onChange={(event) => setShowAllSchemaVersions(event.target.checked)}
            />
            Show collections without pending migrations ({hiddenSchemaVersionCount})
          </label>
        </CardHeader>
        <CardContent className="space-y-3">
          {unversionedSchemaAreaNames.length > 0 && (
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="flex gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <p className="font-medium">
                      {unversionedSchemaAreaNames.length} schema areas are missing version metadata.
                    </p>
                    <p className="text-amber-900/80">
                      Missing version rows are initialized to v1 automatically before bulk apply. This only writes
                      data_schema_versions and does not modify collection documents.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={applySelectedVersionBootstrap}
                      disabled={versionBootstrapApplying}
                    >
                      {versionBootstrapApplying ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Initialize all to v1
                    </Button>
                  </div>
                  {versionBootstrapResult && (
                    <div className="rounded-md border border-emerald-300/60 bg-emerald-50 p-2 text-emerald-900">
                      {Object.entries(versionBootstrapResult.applied_counts).map(([key, value]) => (
                        <div key={key}>
                          {key}: {value}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visibleSchemaVersions.length === 0 ? (
              <div className="rounded-lg border bg-card/60 p-3 text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
                No collections need migration.
              </div>
            ) : (
              visibleSchemaVersions.map((schema) => {
                const needsMigration = schemaVersionNeedsMigration(schema);
                return (
                  <div
                    key={schema.schema_area}
                    className="rounded-lg border bg-card/60 p-3 text-sm"
                  >
                    <div className="flex items-center gap-2 font-medium">
                      {schema.status === "current" && !needsMigration ? (
                        <CheckCircle2 className={cn("h-4 w-4", schemaStatusIconClass(schema.status, needsMigration))} />
                      ) : (
                        <AlertCircle className={cn("h-4 w-4", schemaStatusIconClass(schema.status, needsMigration))} />
                      )}
                      <span>{schema.schema_area}</span>
                    </div>
                    <div className="text-current/70">
                      {formatVersionRange(schema.current_version, schema.target_version)}
                    </div>
                    <Badge variant="outline" className={cn("mt-1", statusColorClass(schema.status))}>
                      {schema.status}
                    </Badge>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 pt-6 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading migration manifest...
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          <div className="space-y-3">
            <div className="space-y-3 rounded-lg border bg-card/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={allPendingMigrationsSelected}
                      disabled={selectableBulkMigrations.length === 0}
                      onChange={(event) => toggleAllPendingMigrations(event.target.checked)}
                    />
                    Select all pending migrations ({selectableBulkMigrations.length})
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {selectedBulkMigrations.length} migrations selected for preview and apply.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={runBulkPlan}
                  disabled={selectedBulkMigrations.length === 0 || bulkPlanning}
                >
                  {bulkPlanning ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PlayCircle className="mr-2 h-4 w-4" />
                  )}
                  Preview selected
                </Button>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(event) => setShowCompleted(event.target.checked)}
                />
                Show completed migrations ({completedMigrations.length})
              </label>
            </div>
            {visibleMigrations.length === 0 && (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">No active migrations.</CardContent>
              </Card>
            )}
            {visibleMigrations.map((migration) => (
              <Card
                key={migration.id}
                className={migration.id === selectedMigration?.id ? "border-primary/60" : undefined}
              >
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button
                      type="button"
                      className="rounded-md text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      onClick={() => {
                        setSelectedId(migration.id);
                        setPlan(null);
                        setApplyResult(null);
                        setConfirmation("");
                      }}
                    >
                      <CardTitle className="text-base">{migration.title}</CardTitle>
                      <CardDescription>{migration.description}</CardDescription>
                    </button>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={kindTone(migration.kind)}>{migration.kind}</Badge>
                      <Badge variant={migration.implemented ? "default" : "outline"}>
                        {migration.implemented ? "ready" : "registered"}
                      </Badge>
                      <Badge variant="outline" className={statusColorClass(migration.status)}>
                        {migration.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <span>Area: {migration.schema_area}</span>
                    <span>Current: {formatVersion(migration.current_version)}</span>
                    <span>Target: {formatVersion(migration.target_version)}</span>
                  </div>
                  {migration.status === "completed" && (
                    <label className="flex w-fit items-center gap-2 rounded-md border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
                      <input
                        aria-label="Migration complete"
                        type="checkbox"
                        checked
                        readOnly
                        className="h-4 w-4 accent-emerald-600"
                      />
                      Migration complete
                    </label>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {migration.status !== "completed" && migration.implemented && (
                      <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                        <input
                          aria-label={`Select migration ${migration.title}`}
                          type="checkbox"
                          checked={selectedBulkMigrationIdSet.has(migration.id)}
                          onChange={(event) => toggleBulkMigration(migration.id, event.target.checked)}
                        />
                        Select
                      </label>
                    )}
                    <Button
                      size="sm"
                      onClick={() => runPlan(migration)}
                      disabled={!migration.implemented || planning}
                    >
                      {planning && selectedMigration?.id === migration.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <PlayCircle className="mr-2 h-4 w-4" />
                      )}
                      Dry run
                    </Button>
                    <Button size="sm" variant="outline" disabled>
                      <Download className="mr-2 h-4 w-4" />
                      JSON report
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>

          <div className="space-y-4">
            {(selectedBulkMigrations.length > 0 || bulkApplyResult) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Bulk Migration Preview</CardTitle>
                  <CardDescription>
                    Review selected migrations, then type the bulk confirmation before applying them in order.
                    Missing schema-version metadata is initialized first.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {selectedBulkMigrations.length > 0
                      ? `${selectedBulkMigrations.length} migrations selected.`
                      : "Bulk apply complete."}
                  </p>
                  {bulkPlans.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Preview selected migrations to unlock apply.</p>
                  ) : (
                    <div className="space-y-3">
                      {bulkPlans.map((bulkPlan) => {
                        const migration = selectedBulkMigrations.find((item) => item.id === bulkPlan.migration_id);
                        return (
                          <div key={bulkPlan.migration_id} className="rounded-lg border p-3">
                            <div className="text-sm font-medium">{migration?.title ?? bulkPlan.migration_id}</div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              {Object.entries(bulkPlan.counts).map(([key, value]) => (
                                <div key={key} className="rounded-md border p-2">
                                  <div className="text-xs text-muted-foreground">{key}</div>
                                  <div className="font-semibold">{value}</div>
                                </div>
                              ))}
                            </div>
                            {bulkPlan.warnings.length > 0 && (
                              <div className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-900">
                                {bulkPlan.warnings.map((warning) => (
                                  <div key={warning}>{warning}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="space-y-2">
                    <label htmlFor="bulk-migration-confirmation" className="text-sm font-medium">
                      Type bulk confirmation
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 rounded bg-muted px-2 py-1 text-xs">
                        {BULK_MIGRATION_CONFIRMATION}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={
                          copiedBulkConfirmation ? "Copied bulk confirmation" : "Copy bulk confirmation"
                        }
                        onClick={copyBulkConfirmationText}
                      >
                        {copiedBulkConfirmation ? (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        ) : (
                          <Copy className="mr-2 h-4 w-4" />
                        )}
                        {copiedBulkConfirmation ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <Input
                      id="bulk-migration-confirmation"
                      value={bulkConfirmation}
                      onChange={(event) => setBulkConfirmation(event.target.value)}
                      placeholder={BULK_MIGRATION_CONFIRMATION}
                    />
                  </div>
                  <Button onClick={applySelectedMigrations} disabled={!canApplySelectedMigrations}>
                    {bulkApplying ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Apply selected
                  </Button>
                  {bulkApplyResult && (
                    <div className="rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-900">
                      <div>Applied {bulkApplyResult.applied_count} selected migration(s).</div>
                      {bulkApplyResult.results.map((result) => (
                        <div key={result.migration_id} className="mt-2">
                          <div className="font-medium">{result.title}</div>
                          {Object.entries(result.applied_counts).map(([key, value]) => (
                            <div key={key}>
                              {key}: {value}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
            <CardHeader>
              <CardTitle className="text-base">Migration Preview</CardTitle>
              <CardDescription>
                Review counts and sample changes, then type the exact confirmation before applying.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!plan ? (
                <div className="space-y-2 text-sm text-muted-foreground">
                  {selectedMigration && (
                    <p>
                      Selected migration:{" "}
                      <span className="font-medium text-foreground">{selectedMigration.title}</span>
                    </p>
                  )}
                  <p>Run a dry run to preview changes.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(plan.counts).map(([key, value]) => (
                      <div key={key} className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">{key}</div>
                        <div className="text-lg font-semibold">{value}</div>
                      </div>
                    ))}
                  </div>
                  {plan.warnings.length > 0 && (
                    <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900">
                      {plan.warnings.map((warning) => (
                        <div key={warning} className="flex gap-2">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {plan.sample_diffs.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Sample Diffs</h4>
                      {plan.sample_diffs.map((diff) => (
                        <pre key={`${diff.collection}:${diff.id}`} className="overflow-auto rounded-lg bg-muted p-3 text-xs">
                          {JSON.stringify(diff, null, 2)}
                        </pre>
                      ))}
                    </div>
                  )}
                  <div className="space-y-2">
                    <label htmlFor="migration-confirmation" className="text-sm font-medium">
                      Type confirmation
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 rounded bg-muted px-2 py-1 text-xs">
                        {plan.confirmation}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={
                          copiedConfirmation ? "Copied confirmation text" : "Copy confirmation text"
                        }
                        onClick={copyConfirmationText}
                      >
                        {copiedConfirmation ? (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        ) : (
                          <Copy className="mr-2 h-4 w-4" />
                        )}
                        {copiedConfirmation ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <Input
                      id="migration-confirmation"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      placeholder={plan.confirmation}
                    />
                  </div>
                  <Button onClick={applySelectedMigration} disabled={!canApply}>
                    {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    Apply
                  </Button>
                  {applyResult && (
                    <div className="rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-900">
                      {Object.entries(applyResult.applied_counts).map(([key, value]) => (
                        <div key={key}>
                          {key}: {value}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          </div>
        </div>
      )}
    </div>
  );
}
