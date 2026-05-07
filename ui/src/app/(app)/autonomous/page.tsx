// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, RefreshCw, Bot, Eye } from "lucide-react";

import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAdminRole } from "@/hooks/use-admin-role";
import { getConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

import {
  autonomousApi,
  AutonomousApiError,
  type AutonomousTask,
} from "@/components/autonomous/api";
import { TaskList } from "@/components/autonomous/TaskList";
import { TaskFormDialog } from "@/components/autonomous/TaskFormDialog";
import { RunHistory } from "@/components/autonomous/RunHistory";

export default function AutonomousAgentsPage() {
  return (
    <AuthGuard>
      <AutonomousAgentsView />
    </AuthGuard>
  );
}

function AutonomousAgentsView() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const autonomousAgentsEnabled = getConfig('autonomousAgentsEnabled');
  // IMP-19: gate writes behind the OIDC admin role. ``canViewAdmin``
  // covers ops/on-call who need to see what's scheduled and inspect
  // run history; only ``isAdmin`` is allowed to create / edit /
  // delete / fire tasks. The proxy at /api/autonomous enforces the
  // same split server-side -- this hook just keeps the UI honest so
  // we don't render buttons that will 403 on click.
  //
  // ``hasViewAccess`` deliberately includes admins. ``useAdminRole``
  // can promote a user to ``isAdmin=true`` via the MongoDB profile
  // fallback (`/api/auth/role`) without ever flipping
  // ``canViewAdmin`` (which is sourced strictly from OIDC claims).
  // The proxy's ``requireAdminView`` short-circuits on ``role ===
  // 'admin'``, so MongoDB-promoted admins are server-authorised to
  // GET /api/autonomous; gating the UI strictly on ``canViewAdmin``
  // would lock those legitimate admins out (caught by Codex review).
  const { isAdmin, canViewAdmin, loading: roleLoading } = useAdminRole();
  const hasViewAccess = isAdmin || canViewAdmin;
  const [tasks, setTasks] = useState<AutonomousTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AutonomousTask | null>(null);
  const [runHistoryRefreshKey, setRunHistoryRefreshKey] = useState(0);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  // Spec #099 FR-010 visibility — surface upcoming-task stats prominently
  // in the header so the operator can answer "what's about to fire?" at a
  // glance without scanning every row. Recomputed on each tasks update;
  // cheap (O(N) over typically <50 tasks).
  const taskStats = useMemo(() => {
    const enabled = tasks.filter((t) => t.enabled);
    const withNext = enabled.filter((t) => t.next_run);
    // Sort ascending by next_run timestamp; first entry is the soonest.
    const upcoming = withNext
      .slice()
      .sort((a, b) => {
        const ta = a.next_run ? new Date(a.next_run).getTime() : Number.POSITIVE_INFINITY;
        const tb = b.next_run ? new Date(b.next_run).getTime() : Number.POSITIVE_INFINITY;
        return ta - tb;
      });
    return {
      total: tasks.length,
      enabledCount: enabled.length,
      scheduledCount: withNext.length,
      nextUp: upcoming[0] ?? null,
      upcoming: upcoming.slice(0, 3),
    };
  }, [tasks]);

  // Internal worker that fetches and merges task list. ``silent`` skips
  // the spinner so the polling loop (spec #099 FR-011) doesn't flicker
  // the UI every 30 seconds.
  const fetchTasks = useCallback(async (silent: boolean) => {
    if (!autonomousAgentsEnabled) {
      setTasks([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const data = await autonomousApi.listTasks();
      setTasks(data);
      setLoadError(null);
      // Auto-select first task on initial load so the right pane is
      // never empty for an operator who already has tasks configured.
      setSelectedId((current) => {
        if (current && data.some((t) => t.id === current)) return current;
        return data[0]?.id ?? null;
      });
    } catch (err) {
      // Polling failures are silent — we keep the last successful task
      // list visible rather than blanking the UI on a transient blip.
      // Manual refresh / first load surfaces the error so the operator
      // sees the failure state.
      if (silent) return;
      const msg =
        err instanceof AutonomousApiError
          ? err.message
          : "Failed to reach the autonomous-agents service. Is it running on :8002?";
      setLoadError(msg);
      setTasks([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [autonomousAgentsEnabled]);

  const reload = useCallback(() => fetchTasks(false), [fetchTasks]);

  useEffect(() => {
    // Don't bother hitting /api/autonomous if the role check is still
    // resolving. Once it resolves, branch on access:
    //   * has view access -> fetch tasks
    //   * no view access  -> drop the initial loading/error state so
    //     the header Refresh button doesn't sit disabled with a
    //     spinning icon forever (the page itself is replaced with the
    //     forbidden banner below, but the header is still rendered).
    //     Caught by Copilot review.
    if (!autonomousAgentsEnabled) return;
    if (roleLoading) return;
    if (!hasViewAccess) {
      setLoading(false);
      setLoadError(null);
      return;
    }
    reload();
  }, [reload, roleLoading, hasViewAccess, autonomousAgentsEnabled]);

  // Spec #099 FR-011: poll for ack + next-run updates so the badge
  // refreshes after a background preflight resolves and the next-run
  // countdown stays accurate without a manual refresh. 30 seconds is
  // the spec-recommended cadence; cheap enough for the UI, infrequent
  // enough to avoid unnecessary load on the autonomous-agents service.
  useEffect(() => {
    if (!autonomousAgentsEnabled || roleLoading || !hasViewAccess) return;
    const interval = window.setInterval(() => {
      fetchTasks(true);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [fetchTasks, roleLoading, hasViewAccess, autonomousAgentsEnabled]);

  // Spec #099 Iteration A — when the chat sidebar's "+ New Chat" is
  // clicked while the Autonomous chip is active, that handler routes
  // here with ?new=1. Auto-open the create dialog so the operator
  // doesn't have to find and click the page-level "New task" button.
  // Strip the query param immediately so a refresh doesn't re-open
  // the dialog if the operator dismissed it.
  useEffect(() => {
    if (!autonomousAgentsEnabled || !isAdmin) return;
    if (searchParams.get('new') !== '1') return;
    setEditingTask(null);
    setDialogOpen(true);
    router.replace('/autonomous');
  }, [searchParams, isAdmin, router, autonomousAgentsEnabled]);

  const markBusy = (id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleCreate = () => {
    setEditingTask(null);
    setDialogOpen(true);
  };

  const handleEdit = (task: AutonomousTask) => {
    setEditingTask(task);
    setDialogOpen(true);
  };

  const handleSubmitTask = async (task: AutonomousTask) => {
    if (editingTask) {
      const updated = await autonomousApi.updateTask(editingTask.id, task);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setSelectedId(updated.id);
      toast(`Task "${updated.name}" updated.`, "success");
    } else {
      const created = await autonomousApi.createTask(task);
      setTasks((prev) => [...prev, created]);
      setSelectedId(created.id);
      toast(`Task "${created.name}" created.`, "success");
    }
  };

  const handleDelete = async (task: AutonomousTask) => {
    // ``window.confirm`` is intentional — the autonomous tab is an
    // operator surface and a custom modal would be overkill. If a
    // future PR introduces a project-wide confirm dialog component,
    // swap this for it.
    if (!window.confirm(`Delete task "${task.name}"? This cannot be undone.`)) {
      return;
    }
    markBusy(task.id, true);
    try {
      await autonomousApi.deleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      if (selectedId === task.id) setSelectedId(null);
      toast(`Task "${task.name}" deleted.`, "success");
    } catch (err) {
      const msg = err instanceof AutonomousApiError ? err.message : "Failed to delete task";
      toast(msg, "error");
    } finally {
      markBusy(task.id, false);
    }
  };

  const handleTrigger = async (task: AutonomousTask) => {
    markBusy(task.id, true);
    try {
      await autonomousApi.triggerTask(task.id);
      toast(`Triggered "${task.name}". Run history will update shortly.`, "success");
      // Bump the refresh key so the right-pane history reloads even
      // if the user has it focused.
      setRunHistoryRefreshKey((n) => n + 1);
      // Surface the new ``next_run`` value on the card.
      try {
        const refreshed = await autonomousApi.getTask(task.id);
        setTasks((prev) => prev.map((t) => (t.id === refreshed.id ? refreshed : t)));
      } catch {
        // Non-fatal; the next full reload will catch it.
      }
    } catch (err) {
      const msg = err instanceof AutonomousApiError ? err.message : "Failed to trigger task";
      toast(msg, "error");
    } finally {
      markBusy(task.id, false);
    }
  };

  if (!autonomousAgentsEnabled) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-foreground">Autonomous Agents Disabled</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This deployment has autonomous scheduling and webhook automation turned off.
          </p>
          <Button type="button" size="sm" className="mt-4" onClick={() => router.push("/")}>
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="shrink-0 border-b border-border px-6 py-4 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Autonomous Agents</h1>
        </div>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Schedule and trigger CAIPE tasks without a human in the loop.
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>
          {isAdmin && (
            <Button
              type="button"
              size="sm"
              onClick={handleCreate}
              data-testid="autonomous-new-task"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New task
            </Button>
          )}
        </div>
      </header>

      {!roleLoading && !isAdmin && canViewAdmin && (
        // Read-only banner: tells the operator why "New task" is
        // missing and why Edit/Delete/Run will be disabled. Without
        // this they'd assume the page was broken.
        <div
          className="mx-6 mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2"
          data-testid="autonomous-readonly-banner"
        >
          <Eye className="h-3.5 w-3.5 shrink-0" />
          <span>
            Read-only view. Ask an administrator to create or modify
            autonomous tasks.
          </span>
        </div>
      )}

      {!roleLoading && !hasViewAccess && (
        // No view access at all -- bail rather than rendering a page
        // whose every API call will 403.
        <div
          className="mx-6 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
          data-testid="autonomous-forbidden"
        >
          You don&apos;t have permission to view autonomous tasks.
          Membership in the OIDC admin or admin-view group is required.
        </div>
      )}

      {loadError && hasViewAccess && (
        <div className="mx-6 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {loadError}
        </div>
      )}

      {hasViewAccess && tasks.length > 0 && (
        // Spec #099 — compact "what's about to fire?" stats bar so the
        // operator can answer the upcoming-runs question without scanning
        // every row. Hidden when no tasks exist (the empty-state below
        // is more useful in that case).
        <div
          className="mx-6 mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-border bg-card px-4 py-2 text-xs"
          data-testid="autonomous-stats"
        >
          <span className="text-muted-foreground">
            Tasks: <span className="font-mono text-foreground">{taskStats.total}</span>
          </span>
          <span className="text-muted-foreground">
            Enabled: <span className="font-mono text-foreground">{taskStats.enabledCount}</span>
          </span>
          <span className="text-muted-foreground">
            Scheduled: <span className="font-mono text-foreground">{taskStats.scheduledCount}</span>
          </span>
          {taskStats.nextUp ? (
            <span className="text-muted-foreground">
              Next up:{" "}
              <button
                type="button"
                onClick={() => setSelectedId(taskStats.nextUp!.id)}
                className="font-medium text-foreground underline-offset-2 hover:underline"
                data-testid="autonomous-stats-next-up"
              >
                {taskStats.nextUp.name}
              </button>
              {taskStats.nextUp.next_run && (
                <span className="ml-1 text-muted-foreground/80">
                  ({(() => {
                    const t = new Date(taskStats.nextUp.next_run).getTime();
                    const deltaSec = Math.round((t - Date.now()) / 1000);
                    const abs = Math.abs(deltaSec);
                    const future = deltaSec >= 0;
                    let unit: string; let n: number;
                    if (abs < 60) { unit = "s"; n = abs; }
                    else if (abs < 3600) { unit = "m"; n = Math.round(abs / 60); }
                    else if (abs < 86400) { unit = "h"; n = Math.round(abs / 3600); }
                    else { unit = "d"; n = Math.round(abs / 86400); }
                    return future ? `in ${n}${unit}` : `${n}${unit} ago`;
                  })()})
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground italic">
              No upcoming runs scheduled.
            </span>
          )}
        </div>
      )}

      {hasViewAccess && (
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 px-6 py-4 overflow-hidden">
        <section className="overflow-y-auto">
          {loading && tasks.length === 0 ? (
            <div className="rounded-md border border-border px-4 py-12 text-center text-sm text-muted-foreground">
              Loading tasks…
            </div>
          ) : (
            <TaskList
              tasks={tasks}
              selectedTaskId={selectedId}
              onSelect={(t) => setSelectedId(t.id)}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onTrigger={handleTrigger}
              busyIds={busyIds}
              readOnly={!isAdmin}
            />
          )}
        </section>

        <section className="overflow-y-auto rounded-lg border border-border bg-card p-4">
          {selectedTask ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {selectedTask.name}
                </h2>
                {selectedTask.description && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedTask.description}
                  </p>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Agent</dt>
                <dd className="font-mono text-foreground">
                  {selectedTask.agent || (
                    <span className="italic text-muted-foreground">
                      (LLM router will choose)
                    </span>
                  )}
                </dd>
                <dt className="text-muted-foreground">Trigger</dt>
                <dd className="font-mono text-foreground">{selectedTask.trigger.type}</dd>
                {selectedTask.timeout_seconds != null && (
                  <>
                    <dt className="text-muted-foreground">Timeout</dt>
                    <dd className="font-mono text-foreground">
                      {selectedTask.timeout_seconds}s
                    </dd>
                  </>
                )}
                {selectedTask.max_retries != null && (
                  <>
                    <dt className="text-muted-foreground">Max retries</dt>
                    <dd className="font-mono text-foreground">{selectedTask.max_retries}</dd>
                  </>
                )}
              </dl>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Prompt</div>
                <pre className="whitespace-pre-wrap break-words text-xs rounded bg-muted p-3 text-foreground">
                  {selectedTask.prompt}
                </pre>
              </div>
              <RunHistory
                taskId={selectedTask.id}
                refreshKey={runHistoryRefreshKey}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {tasks.length === 0
                ? (isAdmin ? "Create a task to get started." : "No autonomous tasks configured yet.")
                : "Select a task to view details and run history."}
            </div>
          )}
        </section>
      </div>
      )}

      {isAdmin && (
        // The form dialog is the *only* way to create or edit a task.
        // Keep it mounted only for admins so a clever user can't pop
        // it open via DOM tooling and try to submit -- the proxy
        // would still 403, but defence in depth is cheap here.
        <TaskFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          task={editingTask}
          onSubmit={handleSubmitTask}
        />
      )}
    </div>
  );
}
