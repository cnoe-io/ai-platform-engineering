// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { RefreshCw, ChevronDown, ChevronRight, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { autonomousApi, AutonomousApiError } from "./api";
import type { TaskRun } from "./types";

interface RunHistoryProps {
  taskId: string;
  /**
   * Refresh trigger — bump this counter from the parent (e.g. right
   * after manually firing a task) to force a reload without waiting
   * for the polling interval.
   */
  refreshKey?: number;
}

const STATUS_BADGE_VARIANT: Record<TaskRun["status"], "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  running: "default",
  success: "default",
  failed: "destructive",
  skipped: "secondary",
};

const STATUS_TONE: Record<TaskRun["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  // ``running`` deserves a distinct hue — the default badge variant
  // collapses into the same blue we use for ``success``, which buries
  // the in-progress state in long lists.
  running: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  skipped: "bg-muted text-muted-foreground",
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatDuration(start: string, end: string | null | undefined): string {
  if (!end) return "—";
  try {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (Number.isNaN(ms) || ms < 0) return "—";
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.round(ms / 100) / 10;
    return `${seconds}s`;
  } catch {
    return "—";
  }
}

export function RunHistory({ taskId, refreshKey = 0 }: RunHistoryProps) {
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Track in-flight requests so a slow response doesn't clobber a
  // newer one — important once the auto-poll kicks in.
  const inflightRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++inflightRef.current;
    setLoading(true);
    try {
      const data = await autonomousApi.listRuns(taskId);
      if (requestId !== inflightRef.current) return;
      setRuns(data);
      setError(null);
    } catch (err) {
      if (requestId !== inflightRef.current) return;
      // 404 with "Task not found" is benign for a brand-new task that
      // hasn't run yet AND has no definition (deleted). We surface it
      // anyway so operators can spot a typo'd task id.
      const message =
        err instanceof AutonomousApiError ? err.message : "Failed to load run history";
      setError(message);
      setRuns([]);
    } finally {
      if (requestId === inflightRef.current) setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Light auto-poll so a freshly triggered run shows its terminal
  // state without the operator hitting refresh. 5s is conservative;
  // the run-history endpoint is read-only and goes through Mongo's
  // primary index, so the load is negligible.
  useEffect(() => {
    const interval = setInterval(() => {
      load();
    }, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const toggleExpanded = (runId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Run history</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={load}
          disabled={loading}
          aria-label="Refresh run history"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {!error && runs.length === 0 && !loading && (
        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          No runs yet. Trigger the task to generate history.
        </div>
      )}

      <ul className="flex flex-col gap-1">
        {runs.map((run) => {
          const isOpen = expanded.has(run.run_id);
          return (
            <li
              key={run.run_id}
              className="rounded-md border border-border bg-card text-card-foreground"
            >
              <button
                type="button"
                onClick={() => toggleExpanded(run.run_id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50 transition-colors"
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <Badge
                  variant={STATUS_BADGE_VARIANT[run.status]}
                  className={cn("uppercase tracking-wide", STATUS_TONE[run.status])}
                >
                  {run.status}
                </Badge>
                <span className="font-mono text-muted-foreground truncate">
                  {run.run_id}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {formatTimestamp(run.started_at)}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {formatDuration(run.started_at, run.finished_at)}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-border px-3 py-2 text-xs space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">Started:</span>{" "}
                      {formatTimestamp(run.started_at)}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Finished:</span>{" "}
                      {formatTimestamp(run.finished_at)}
                    </div>
                  </div>
                  {run.conversation_id && (
                    // IMP-13 wired conversation_id onto the run; this
                    // closes the UX loop by giving operators a one-click
                    // jump from a run row to the full prompt + response
                    // thread in /chat/<id>. Hidden when the field is
                    // absent (chat publishing disabled or pre-IMP-13
                    // run) so the row stays tidy in those modes.
                    <div className="flex justify-end">
                      <Button
                        asChild
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                      >
                        <Link
                          href={`/chat/${run.conversation_id}`}
                          aria-label={`Open run ${run.run_id} in chat`}
                          data-testid="run-chat-link"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          Open in chat
                        </Link>
                      </Button>
                    </div>
                  )}
                  {run.error && (
                    <div>
                      <div className="font-medium text-foreground mb-1">Error</div>
                      <pre className="whitespace-pre-wrap break-words rounded bg-red-500/10 p-2 text-red-700 dark:text-red-300">
                        {run.error}
                      </pre>
                    </div>
                  )}
                  {run.response_preview && (
                    <div>
                      <div className="font-medium text-foreground mb-1">Response preview</div>
                      <pre className="whitespace-pre-wrap break-words rounded bg-muted p-2 text-foreground">
                        {run.response_preview}
                      </pre>
                    </div>
                  )}
                  {!run.error && !run.response_preview && (
                    <div className="text-muted-foreground italic">
                      No response captured.
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
