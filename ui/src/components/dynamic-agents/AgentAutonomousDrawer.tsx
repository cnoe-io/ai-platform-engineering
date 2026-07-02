"use client";

import React, { useCallback, useEffect, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { TaskFormDialog } from "@/components/autonomous/TaskFormDialog";
import { autonomousApi, AutonomousApiError } from "@/components/autonomous/api";
import type { AutonomousTask } from "@/components/autonomous/types";
import type { DynamicAgentConfigWithPermissions } from "@/types/dynamic-agent";

import { AgentTaskAccordion } from "./AgentTaskAccordion";
import { isTaskOwnedByAgent } from "./taskOwnership";

interface AgentAutonomousDrawerProps {
  agent: DynamicAgentConfigWithPermissions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Agent-scoped autonomous-task manager (redesign spec 2026-07-02). Filters
 * tasks to a single agent and renders them as a list-first accordion
 * (AgentTaskAccordion). Reuses autonomousApi / TaskFormDialog / RunHistory;
 * no authz or API changes.
 */
export function AgentAutonomousDrawer({ agent, open, onOpenChange }: AgentAutonomousDrawerProps) {
  const { toast } = useToast();
  const agentId = agent._id;

  const [tasks, setTasks] = useState<AutonomousTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AutonomousTask | null>(null);
  const [runHistoryRefreshKey, setRunHistoryRefreshKey] = useState(0);
  // Id of the most-recently-created task, so the accordion auto-expands it.
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const all = await autonomousApi.listTasks();
      const mine = all.filter((t) => isTaskOwnedByAgent(t, agentId));
      setTasks(mine);
      setLoadError(null);
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
      toast(`Task "${updated.name}" updated.`, "success");
    } else {
      const created = await autonomousApi.createTask(task);
      setTasks((prev) => [...prev, created]);
      setLastCreatedId(created.id);
      toast(`Task "${created.name}" created.`, "success");
    }
  };

  const handleDelete = async (task: AutonomousTask) => {
    if (!window.confirm(`Delete task "${task.name}"? This cannot be undone.`)) return;
    markBusy(task.id, true);
    try {
      await autonomousApi.deleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      if (lastCreatedId === task.id) setLastCreatedId(null);
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
      {/* Bounded height + inner scroll so a long run history scrolls inside
          the panel instead of stretching the dialog past the viewport. */}
      <DialogContent className="flex max-h-[85vh] w-[min(48rem,95vw)] max-w-none flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Autonomous · {agent.name}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </p>
          <Button size="sm" variant="outline" onClick={handleCreate}>
            + New task
          </Button>
        </div>

        {loadError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <span>{loadError}</span>
            <button type="button" onClick={fetchTasks} className="underline">
              Retry
            </button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
            {loading ? "Loading…" : "No autonomous tasks for this agent yet."}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <AgentTaskAccordion
              tasks={tasks}
              busyIds={busyIds}
              runHistoryRefreshKey={runHistoryRefreshKey}
              defaultExpandedId={lastCreatedId}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onTrigger={handleTrigger}
            />
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
