"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Save, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type PodStatus = "owned" | "pgm_only" | "unowned";

interface PodOwnerCandidate {
  owner_user_id: string;
  sources: string[];
  count: number;
  known_user: boolean;
}

interface PodOwnerMigrationItem {
  pod_id: string;
  name: string | null;
  default_meeting_series: string | null;
  owner_user_id: string | null;
  pgm_email: string | null;
  status: PodStatus;
  needs_owner: boolean;
  candidates: PodOwnerCandidate[];
  recommended_owner_user_id: string | null;
  recommended_source: string | null;
}

interface PodOwnerMigrationUser {
  email: string;
  name: string;
  role: string;
}

interface PodOwnerMigrationState {
  summary: {
    total: number;
    with_owner: number;
    pgm_only: number;
    without_owner: number;
    unowned: number;
    with_recommendation: number;
  };
  users: PodOwnerMigrationUser[];
  pods: PodOwnerMigrationItem[];
}

const statusLabel: Record<PodStatus, string> = {
  owned: "Explicit owner",
  pgm_only: "PGM only",
  unowned: "No owner signal",
};

function statusClass(status: PodStatus): string {
  switch (status) {
    case "owned":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "pgm_only":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "unowned":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  }
}

function displayPodName(pod: PodOwnerMigrationItem): string {
  return pod.name || pod.default_meeting_series || pod.pod_id;
}

function candidateSummary(candidates: PodOwnerCandidate[]): string {
  if (candidates.length === 0) return "-";
  return candidates
    .slice(0, 3)
    .map((candidate) => {
      const unknown = candidate.known_user ? "" : " (not in users)";
      return `${candidate.owner_user_id}${unknown}`;
    })
    .join(", ");
}

export function PodOwnerMigrationTab({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState<PodOwnerMigrationState | null>(null);
  const [selectedOwners, setSelectedOwners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingPodId, setSavingPodId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userOptions = useMemo(() => data?.users ?? [], [data]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/pod-owner-migration", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || `Load failed with HTTP ${response.status}`);
      }
      const nextData = body.data as PodOwnerMigrationState;
      setData(nextData);
      setSelectedOwners(
        Object.fromEntries(
          nextData.pods.map((pod) => [
            pod.pod_id,
            pod.owner_user_id || pod.recommended_owner_user_id || "",
          ]),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pod owner migration state.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveOwner(pod: PodOwnerMigrationItem) {
    if (!isAdmin) return;
    const owner = selectedOwners[pod.pod_id] || "";
    if (!owner || owner === pod.owner_user_id) return;

    setSavingPodId(pod.pod_id);
    setError(null);
    try {
      const response = await fetch("/api/admin/pod-owner-migration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pod_id: pod.pod_id, owner_user_id: owner }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || `Save failed with HTTP ${response.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save pod owner.");
    } finally {
      setSavingPodId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Pod Meeting Owners
            </CardTitle>
            <CardDescription>
              Temporary migration surface for assigning owner_user_id on legacy pod meetings.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading || savingPodId !== null}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isAdmin && (
            <div className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertCircle className="h-4 w-4" />
              Admin role required to apply owner assignments.
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {loading && !data && (
            <div className="flex items-center gap-2 rounded border bg-muted/20 px-3 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading pod meetings...
            </div>
          )}

          {data && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                {[
                  ["Total", data.summary.total],
                  ["With owner", data.summary.with_owner],
                  ["Missing owner", data.summary.without_owner],
                  ["PGM only", data.summary.pgm_only],
                  ["No signal", data.summary.unowned],
                  ["Recommended", data.summary.with_recommendation],
                ].map(([label, value]) => (
                  <div key={label} className="rounded border bg-muted/20 px-3 py-2">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-lg font-semibold">{value}</div>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto rounded border">
                <table className="w-full min-w-[1080px] text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Pod Meeting</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                      <th className="px-3 py-2 text-left font-medium">Current</th>
                      <th className="px-3 py-2 text-left font-medium">Signals</th>
                      <th className="px-3 py-2 text-left font-medium">Owner</th>
                      <th className="px-3 py-2 text-left font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pods.map((pod) => {
                      const selectedOwner = selectedOwners[pod.pod_id] || "";
                      const canSave = isAdmin && selectedOwner && selectedOwner !== pod.owner_user_id;
                      return (
                        <tr key={pod.pod_id} className="border-b last:border-b-0">
                          <td className="px-3 py-2">
                            <div className="font-medium">{displayPodName(pod)}</div>
                            <div className="font-mono text-xs text-muted-foreground">{pod.pod_id}</div>
                            {pod.default_meeting_series && pod.default_meeting_series !== displayPodName(pod) && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                Series: {pod.default_meeting_series}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className={cn("rounded border px-2 py-0.5 text-xs font-medium", statusClass(pod.status))}>
                              {statusLabel[pod.status]}
                            </span>
                            {pod.recommended_owner_user_id && (
                              <div className="mt-1 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
                                <CheckCircle2 className="h-3 w-3" />
                                Recommended
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">owner_user_id:</span>{" "}
                              <span className="font-mono">{pod.owner_user_id || "-"}</span>
                            </div>
                            <div className="mt-1">
                              <span className="text-muted-foreground">pgm_email:</span>{" "}
                              <span className="font-mono">{pod.pgm_email || "-"}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs" title={pod.candidates.map((c) => `${c.owner_user_id}: ${c.sources.join(", ")}`).join("\n")}>
                            <div className="max-w-[260px] truncate">{candidateSummary(pod.candidates)}</div>
                            {pod.recommended_source && (
                              <div className="mt-1 text-muted-foreground">{pod.recommended_source}</div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={selectedOwner}
                              onChange={(event) =>
                                setSelectedOwners((current) => ({
                                  ...current,
                                  [pod.pod_id]: event.target.value,
                                }))
                              }
                              disabled={!isAdmin || savingPodId !== null || userOptions.length === 0}
                              className="h-8 w-full min-w-[260px] rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <option value="">Select owner...</option>
                              {userOptions.map((user) => (
                                <option key={user.email} value={user.email}>
                                  {user.name && user.name !== user.email ? `${user.name} <${user.email}>` : user.email}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              size="sm"
                              onClick={() => saveOwner(pod)}
                              disabled={!canSave || savingPodId !== null}
                            >
                              {savingPodId === pod.pod_id ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Save className="mr-2 h-4 w-4" />
                              )}
                              Save
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                    {data.pods.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                          No pod meetings found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
