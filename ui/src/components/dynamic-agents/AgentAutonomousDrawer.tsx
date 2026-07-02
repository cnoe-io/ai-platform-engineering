"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { TaskList } from "@/components/autonomous/TaskList";
import { RunHistory } from "@/components/autonomous/RunHistory";
import { TaskFormDialog } from "@/components/autonomous/TaskFormDialog";
import { autonomousApi, AutonomousApiError } from "@/components/autonomous/api";
import type { AutonomousTask } from "@/components/autonomous/types";
import type { DynamicAgentConfigWithPermissions } from "@/types/dynamic-agent";

import { isTaskOwnedByAgent } from "./taskOwnership";

interface AgentAutonomousDrawerProps {
  agent: DynamicAgentConfigWithPermissions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Agent-scoped autonomous-task manager (spec 2026-07-02). Mirrors the
 * /autonomous page's task wiring but filtered to a single agent's tasks.
 * Reuses TaskList / RunHistory / TaskFormDialog; no authz or API changes.
 */
export function AgentAutonomousDrawer({ agent, open, onOpenChange }: AgentAutonomousDrawerProps) {
  const { toast } = useToast();
  const agentId = agent._id;

  const [tasks, setTasks] = useState<AutonomousTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AutonomousTask | null>(null);
  const [runHistoryRefreshKey, setRunHistoryRefreshKey] = useState(0);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const all = await autonomousApi.listTasks();
      const mine = all.filter((t) => isTaskOwnedByAgent(t, agentId));
      setTasks(mine);
      setLoadError(null);
      setSelectedId((current) => {
        if (current && mine.some((t) => t.id === current)) return current;
        return mine[0]?.id ?? null;
      });
    } catch (err) {
      setLoadError(
        err instanceof AutonomousApiError ? err.message : "Failed to load autonomous tasks.",
      );
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (open) fetchTasks();
  }, [open, fetchTasks]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

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
    if (!window.confirm(`Delete task "${task.name}"? This cannot be undone.`)) return;
    markBusy(task.id, true);
    try {
      await autonomousApi.deleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      if (selectedId === task.id) setSelectedId(null);
      toast(`Task "${task.name}" deleted.`, "success");
    } catch (err) {
      toast(err instanceof AutonomousApiError ? err.message : "Failed to delete task", "error");
    } finally {
      markBusy(task.id, false);
    }
  };

  const handleTrigger = async (task: AutonomousTask) => {
    markBusy(task.id, true);
    try {
      await autonomousApi.triggerTask(task.id);
      toast(`Triggered "${task.name}". Run history will update shortly.`, "success");
      setRunHistoryRefreshKey((n) => n + 1);
      try {
        const refreshed = await autonomousApi.getTask(task.id);
        setTasks((prev) => prev.map((t) => (t.id === refreshed.id ? refreshed : t)));
      } catch {
        // Non-fatal; the next reload will catch the updated next_run.
      }
    } catch (err) {
      toast(err instanceof AutonomousApiError ? err.message : "Failed to trigger task", "error");
    } finally {
      markBusy(task.id, false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Bounded height + column-level scrolling so a long run history scrolls
          inside the panel instead of stretching the dialog past the viewport. */}
      <DialogContent className="flex max-h-[85vh] w-[min(64rem,95vw)] max-w-none flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Autonomous · {agent.name}</DialogTitle>
        </DialogHeader>

        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={handleCreate}>
            + Add autonomous task
          </Button>
        </div>

        {loadError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <span>{loadError}</span>
            <button type="button" onClick={fetchTasks} className="underline">
              Retry
            </button>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            {/* Left: task list — scrolls independently. */}
            <div className="min-h-0 overflow-y-auto pr-1">
              <TaskList
                tasks={tasks}
                selectedTaskId={selectedId}
                onSelect={(t) => setSelectedId(t.id)}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onTrigger={handleTrigger}
                busyIds={busyIds}
              />
            </div>
            {/* Right: selected task's next run + run history — scrolls independently. */}
            <div className="min-h-0 overflow-y-auto border-t pt-4 md:border-l md:border-t-0 md:pl-6 md:pt-0">
              {selectedTask ? (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    Next run: {selectedTask.next_run ?? "—"}
                  </div>
                  <RunHistory taskId={selectedTask.id} refreshKey={runHistoryRefreshKey} />
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {loading ? "Loading…" : "No autonomous tasks for this agent yet."}
                </div>
              )}
            </div>
          </div>
        )}

        <TaskFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          task={editingTask}
          initialAgentId={agentId}
          onSubmit={handleSubmitTask}
        />
      </DialogContent>
    </Dialog>
  );
}
