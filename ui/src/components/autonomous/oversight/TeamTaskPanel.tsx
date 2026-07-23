"use client";

import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { TaskList } from "@/components/autonomous/TaskList";
import { RunHistory } from "@/components/autonomous/RunHistory";
import { autonomousApi, AutonomousApiError } from "@/components/autonomous/api";
import type { AutonomousTask } from "@/components/autonomous/types";
import type { OversightPerson } from "@/lib/autonomous/oversight-grouping";

interface TeamTaskPanelProps {
  title: string;
  members: OversightPerson[];
  onBack: () => void;
  /** Called after a mutation (pause/trigger/delete) so the parent refetches. */
  onChanged: () => void;
}

export function TeamTaskPanel({ title, members, onBack, onChanged }: TeamTaskPanelProps) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [runsRefresh, setRunsRefresh] = useState(0);

  const markBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const guarded = async (task: AutonomousTask, fn: () => Promise<void>) => {
    markBusy(task.id, true);
    try {
      await fn();
      onChanged();
    } catch (err) {
      toast(err instanceof AutonomousApiError ? err.message : "Action failed", "error");
    } finally {
      markBusy(task.id, false);
    }
  };

  const handleTrigger = (task: AutonomousTask) =>
    guarded(task, async () => {
      await autonomousApi.triggerTask(task.id);
      setRunsRefresh((n) => n + 1);
      toast(`Triggered "${task.name}".`, "success");
    });

  const handleDelete = (task: AutonomousTask) => {
    if (!window.confirm(`Delete task "${task.name}"? This cannot be undone.`)) return;
    void guarded(task, async () => {
      await autonomousApi.deleteTask(task.id);
      if (selectedId === task.id) setSelectedId(null);
      toast(`Task "${task.name}" deleted.`, "success");
    });
  };

  // Pause/resume — TaskList renders a dedicated Pause/Resume control for this
  // via `onToggleEnabled`. The full-object PUT is safe: the backend preserves
  // owner/secret/ack on an enabled-only change.
  const handleToggleEnabled = (task: AutonomousTask) =>
    guarded(task, async () => {
      await autonomousApi.updateTask(task.id, { ...task, enabled: !task.enabled });
      toast(`Task "${task.name}" ${task.enabled ? "paused" : "resumed"}.`, "success");
    });

  const selectedTask = members.flatMap((m) => m.tasks).find((t) => t.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onBack}>← Teams</Button>
        <h2 className="text-sm font-medium">{title}</h2>
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-6">
          {members.map((person) => (
            <section key={person.email} className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">{person.email}</h3>
              <TaskList
                tasks={person.tasks}
                selectedTaskId={selectedId}
                onSelect={(t) => setSelectedId(t.id)}
                onToggleEnabled={handleToggleEnabled}
                onDelete={handleDelete}
                onTrigger={handleTrigger}
                busyIds={busyIds}
                showOwner={false}
              />
            </section>
          ))}
        </div>
        <div>
          {selectedTask ? (
            <RunHistory taskId={selectedTask.id} refreshKey={runsRefresh} />
          ) : (
            <div className="text-sm text-muted-foreground">Select a task to see its runs.</div>
          )}
        </div>
      </div>
    </div>
  );
}
