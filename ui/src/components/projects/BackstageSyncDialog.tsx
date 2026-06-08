"use client";

// assisted-by Cursor Composer

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { cn } from "@/lib/utils";
import type { BackstageConflictResolution } from "@/lib/projects/backstage-sync";

interface BackstageSystemRow {
  slug: string;
  title: string;
  description: string;
  entityRef: string;
  already_imported: boolean;
}

interface SyncPreviewRow {
  slug: string;
  title: string;
  exists: boolean;
  has_conflict: boolean;
  conflicts: Array<{ field: string; local: string; backstage: string }>;
}

type Phase = "select" | "preview" | "done";

export function BackstageSyncDialog({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("select");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systems, setSystems] = useState<BackstageSystemRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<TeamPickerOption[]>([]);
  const [preview, setPreview] = useState<SyncPreviewRow[]>([]);
  const [resolutions, setResolutions] = useState<
    Record<string, BackstageConflictResolution>
  >({});
  const [results, setResults] = useState<
    Array<{ slug: string; action: string }>
  >([]);

  const reset = useCallback(() => {
    setPhase("select");
    setError(null);
    setSelected(new Set());
    setTeamId("");
    setPreview([]);
    setResolutions({});
    setResults([]);
  }, []);

  const loadDiscover = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/backstage/discover");
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? body.message ?? "Failed to load Backstage");
      }
      setSystems((body.data?.systems ?? []) as BackstageSystemRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    void loadDiscover();
    fetch("/api/dynamic-agents/teams")
      .then((res) => res.json())
      .then((data) => {
        const list = (data.data ?? data.teams ?? []) as Array<{
          _id: string;
          name: string;
          slug?: string;
        }>;
        setTeams(
          list.map((t) => ({
            slug: t.slug ?? t._id,
            name: t.name,
            id: t._id,
            _id: t._id,
          })),
        );
      })
      .catch(() => setTeams([]));
  }, [open, loadDiscover, reset]);

  const selectedSlugs = useMemo(() => Array.from(selected), [selected]);

  async function runPreview() {
    if (selectedSlugs.length === 0) {
      setError("Select at least one project to sync");
      return;
    }
    const needsTeam = selectedSlugs.some(
      (slug) => !systems.find((s) => s.slug === slug)?.already_imported,
    );
    if (needsTeam && !teamId) {
      setError("Choose a team for new imports");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/backstage/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: selectedSlugs, team_id: teamId || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? body.message ?? "Sync preview failed");
      }
      const rows = (body.data?.preview ?? []) as SyncPreviewRow[];
      setPreview(rows);
      const defaults: Record<string, BackstageConflictResolution> = {};
      for (const row of rows) {
        defaults[row.slug] = row.has_conflict ? "use_backstage" : "use_backstage";
      }
      setResolutions(defaults);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function applySync() {
    setLoading(true);
    setError(null);
    try {
      const items = preview.map((row) => ({
        slug: row.slug,
        resolution: resolutions[row.slug] ?? "use_backstage",
        team_id: teamId || undefined,
      }));
      const res = await fetch("/api/projects/backstage/sync", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? body.message ?? "Sync failed");
      }
      setResults(body.data?.results ?? []);
      setPhase("done");
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Sync from Backstage</h2>
            <p className="text-sm text-muted-foreground">
              Import catalog systems using server Backstage credentials
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              reset();
            }}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {phase === "select" ? (
            <>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Default team for new imports</span>
                <TeamPicker
                  options={teams}
                  value={teamId}
                  onChange={setTeamId}
                  placeholder="Select team"
                  hideSlugSuffix
                />
              </div>

              {loading && systems.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading Backstage systems…
                </p>
              ) : null}

              <ul className="divide-y divide-border rounded-xl border border-border">
                {systems.map((system) => {
                  const checked = selected.has(system.slug);
                  return (
                    <li key={system.slug}>
                      <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/30">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(system.slug)) next.delete(system.slug);
                              else next.add(system.slug);
                              return next;
                            });
                          }}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{system.title}</span>
                            <span className="text-xs text-muted-foreground">
                              {system.slug}
                            </span>
                            {system.already_imported ? (
                              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                exists locally
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {system.description}
                          </p>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>

              {!loading && systems.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No Backstage systems found. Check BACKSTAGE_URL and BACKSTAGE_API_TOKEN.
                </p>
              ) : null}
            </>
          ) : null}

          {phase === "preview" ? (
            <div className="space-y-4">
              {preview.map((row) => (
                <div
                  key={row.slug}
                  className={cn(
                    "rounded-xl border p-4",
                    row.has_conflict ? "border-amber-300 bg-amber-50/50" : "border-border",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {row.has_conflict ? (
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    )}
                    <span className="font-medium">{row.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.exists ? "update" : "create"}
                    </span>
                  </div>

                  {row.has_conflict ? (
                    <div className="mt-3 space-y-2">
                      {row.conflicts.map((conflict) => (
                        <div
                          key={`${row.slug}-${conflict.field}`}
                          className="rounded-lg bg-background/80 p-3 text-xs"
                        >
                          <p className="font-medium capitalize">{conflict.field}</p>
                          <p className="text-muted-foreground">
                            Local: {conflict.local}
                          </p>
                          <p className="text-muted-foreground">
                            Backstage: {conflict.backstage}
                          </p>
                        </div>
                      ))}
                      <label className="block text-sm">
                        <span className="font-medium">Resolution</span>
                        <select
                          value={resolutions[row.slug] ?? "use_backstage"}
                          onChange={(e) =>
                            setResolutions((prev) => ({
                              ...prev,
                              [row.slug]: e.target.value as BackstageConflictResolution,
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        >
                          <option value="use_backstage">Use Backstage</option>
                          <option value="keep_local">Keep local</option>
                          <option value="merge">Merge (Backstage data, selected team)</option>
                        </select>
                      </label>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {phase === "done" ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-emerald-700">Sync complete</p>
              <ul className="space-y-1 text-sm">
                {results.map((row) => (
                  <li key={row.slug}>
                    {row.slug}: {row.action}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={() => void loadDiscover()}
            disabled={loading}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </button>
          <div className="flex gap-2">
            {phase === "select" ? (
              <button
                type="button"
                disabled={loading || selectedSlugs.length === 0}
                onClick={() => void runPreview()}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {loading ? "Checking…" : "Preview sync"}
              </button>
            ) : null}
            {phase === "preview" ? (
              <>
                <button
                  type="button"
                  onClick={() => setPhase("select")}
                  className="rounded-xl border border-border px-4 py-2 text-sm"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void applySync()}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {loading ? "Applying…" : "Apply sync"}
                </button>
              </>
            ) : null}
            {phase === "done" ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  reset();
                }}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Done
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
