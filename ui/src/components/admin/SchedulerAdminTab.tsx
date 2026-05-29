"use client";

import React, { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ReconcileStatus = "current" | "would_patch" | "patched" | "missing" | "error";

interface ReconcileItem {
  schedule_id: string;
  cronjob_name: string;
  status: ReconcileStatus;
  current_image?: string | null;
  desired_image?: string | null;
  current_image_pull_policy?: string | null;
  desired_image_pull_policy?: string | null;
  error?: string | null;
}

interface ReconcileResult {
  dry_run: boolean;
  desired_image: string;
  desired_image_pull_policy: string;
  total: number;
  current: number;
  would_patch: number;
  patched: number;
  missing: number;
  failed: number;
  items: ReconcileItem[];
}

const statusLabel: Record<ReconcileStatus, string> = {
  current: "Current",
  would_patch: "Would patch",
  patched: "Patched",
  missing: "Missing",
  error: "Error",
};

function statusClass(status: ReconcileStatus): string {
  switch (status) {
    case "current":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "would_patch":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "patched":
      return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "missing":
    case "error":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  }
}

function shortImage(image?: string | null): string {
  if (!image) return "-";
  const tag = image.split(":").pop();
  return tag && tag !== image ? tag : image;
}

export function SchedulerAdminTab({ isAdmin }: { isAdmin: boolean }) {
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMode, setLoadingMode] = useState<"dry-run" | "apply" | null>(null);

  const canApply = isAdmin && result?.dry_run === true && result.would_patch > 0;

  async function runReconcile(dryRun: boolean) {
    if (!isAdmin) return;
    setError(null);
    setLoadingMode(dryRun ? "dry-run" : "apply");
    try {
      const response = await fetch("/api/admin/scheduler/reconcile-cronjobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || `Reconcile failed with HTTP ${response.status}`);
      }
      setResult(body as ReconcileResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconcile failed.");
    } finally {
      setLoadingMode(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4" />
              CronJob Runner Images
            </CardTitle>
            <CardDescription>
              Dry-run and apply runner image updates for existing scheduled-job CronJobs.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => runReconcile(true)}
              disabled={!isAdmin || loadingMode !== null}
            >
              {loadingMode === "dry-run" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Dry Run
            </Button>
            <Button
              size="sm"
              onClick={() => runReconcile(false)}
              disabled={!canApply || loadingMode !== null}
            >
              {loadingMode === "apply" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Apply
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isAdmin && (
            <div className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertCircle className="h-4 w-4" />
              Admin role required.
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {result && (
            <>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["Total", result.total],
                  ["Current", result.current],
                  ["Would patch", result.would_patch],
                  ["Patched", result.patched],
                  ["Missing", result.missing],
                  ["Failed", result.failed],
                ].map(([label, value]) => (
                  <div key={label} className="rounded border bg-muted/20 px-3 py-2">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-lg font-semibold">{value}</div>
                  </div>
                ))}
              </div>

              <div className="rounded border bg-muted/20 px-3 py-2 text-xs">
                <span className="font-medium">Desired image:</span>{" "}
                <code className="break-all">{result.desired_image}</code>
              </div>

              <div className="overflow-x-auto rounded border">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Schedule</th>
                      <th className="px-3 py-2 text-left font-medium">CronJob</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                      <th className="px-3 py-2 text-left font-medium">Current</th>
                      <th className="px-3 py-2 text-left font-medium">Desired</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => (
                      <tr key={`${item.schedule_id}:${item.cronjob_name}`} className="border-b last:border-b-0">
                        <td className="px-3 py-2 font-mono text-xs">{item.schedule_id}</td>
                        <td className="px-3 py-2 font-mono text-xs">{item.cronjob_name}</td>
                        <td className="px-3 py-2">
                          <span className={cn("rounded border px-2 py-0.5 text-xs font-medium", statusClass(item.status))}>
                            {statusLabel[item.status]}
                          </span>
                          {item.error && (
                            <div className="mt-1 max-w-[260px] text-xs text-red-600 dark:text-red-300">
                              {item.error}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs" title={item.current_image || undefined}>
                          {shortImage(item.current_image)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs" title={item.desired_image || undefined}>
                          {shortImage(item.desired_image)}
                        </td>
                      </tr>
                    ))}
                    {result.items.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                          No schedules found.
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
