"use client";

import React from "react";
import { CheckCircle, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TaskItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface TaskListProps {
  tasks: TaskItem[];
  /** Whether tasks can be modified (false for historical messages) */
  readonly?: boolean;
  className?: string;
}

/**
 * Displays a list of tasks/todos with status indicators and progress bar.
 * Similar to A2A plan steps but for DA todo items.
 */
export function TaskList({ tasks, readonly = false, className }: TaskListProps) {
  if (tasks.length === 0) return null;

  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const progressPercent = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Task items */}
      <div className="space-y-1">
        {tasks.map((task, index) => (
          <TaskItemRow key={index} task={task} readonly={readonly} />
        ))}
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {completedCount}/{tasks.length}
        </span>
      </div>
    </div>
  );
}

function TaskItemRow({
  task,
  readonly,
}: {
  task: TaskItem;
  readonly: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 px-2 py-1.5 rounded text-xs",
        readonly && "opacity-70"
      )}
    >
      <TaskStatusIcon status={task.status} />
      <span
        className={cn(
          "flex-1 leading-relaxed",
          task.status === "completed" && "text-muted-foreground line-through opacity-60",
          task.status === "in_progress" && "text-foreground font-medium",
          task.status === "pending" && "text-foreground/70"
        )}
      >
        {task.content}
      </span>
    </div>
  );
}

function TaskStatusIcon({ status }: { status: TaskItem["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />;
    case "in_progress":
      return <Loader2 className="h-3.5 w-3.5 text-sky-400 animate-spin shrink-0 mt-0.5" />;
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />;
  }
}

/**
 * Compact variant for inline display (e.g., in summary bars)
 */
export function TaskProgress({
  tasks,
  className,
}: {
  tasks: TaskItem[];
  className?: string;
}) {
  if (tasks.length === 0) return null;

  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;

  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] text-muted-foreground", className)}>
      {inProgressCount > 0 && (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      )}
      <span>{completedCount}/{tasks.length} tasks</span>
    </span>
  );
}
