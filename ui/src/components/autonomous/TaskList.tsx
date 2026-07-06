// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

"use client";

import React from "react";
import Link from "next/link";
import { Pencil, Play, Pause, CirclePlay, Trash2, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { AutonomousTask } from "./types";
import { ackBadgeFor, ackTooltip, describeTrigger, formatNextRun, formatRelative, TriggerIcon } from "./taskPresentation";

interface TaskListProps {
  tasks: AutonomousTask[];
  selectedTaskId: string | null;
  onSelect: (task: AutonomousTask) => void;
  /**
   * Opens the edit form. Optional so surfaces that don't edit task definitions
   * (e.g. admin oversight, which pauses/resumes instead) can omit it. When
   * omitted and `onToggleEnabled` is provided, the row shows a Pause/Resume
   * control in the Edit slot instead of a pencil.
   */
  onEdit?: (task: AutonomousTask) => void;
  /**
   * Pause/resume handler. When provided, the row renders a clear Pause (for an
   * enabled task) / Resume (for a paused one) button in place of the Edit
   * pencil — used by the admin oversight panel, where the action is toggling
   * `enabled`, not editing the definition.
   */
  onToggleEnabled?: (task: AutonomousTask) => void;
  onDelete: (task: AutonomousTask) => void;
  onTrigger: (task: AutonomousTask) => void;
  /** ids that are currently being acted on (delete/trigger) — used to grey out buttons. */
  busyIds: Set<string>;
  /**
   * Plan section 4.3 — admin-only owner column. When true, render a
   * small `owner_id` line under the task title so admins can tell who
   * created each task. Non-admins only ever see their own tasks
   * (backend-filtered), so the column is pointless noise for them.
   */
  showOwner?: boolean;
  /**
   * Email of the currently authenticated user. Only consulted when
   * `showOwner` is true — used to sort the caller's own tasks to the
   * top of the list so an admin viewing a populated system sees their
   * own tasks first rather than scrolling through everyone else's.
   */
  currentUserEmail?: string | null;
}

export function TaskList({
  tasks,
  selectedTaskId,
  onSelect,
  onEdit,
  onToggleEnabled,
  onDelete,
  onTrigger,
  busyIds,
  showOwner = false,
  currentUserEmail = null,
}: TaskListProps) {
  if (tasks.length === 0) {
    // Plan section 4.3 — collapsed empty-state copy. Both an admin
    // viewing a globally-empty system and a non-admin with zero
    // personal tasks land here, and "create one" is the right next
    // action in both cases.
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
        No autonomous tasks yet. Click &quot;New task&quot; to create one.
      </div>
    );
  }

  // Plan section 4.3 — sort the caller's own tasks first when the
  // admin owner column is shown. Cheap (O(N log N) over typically <50
  // tasks). Non-mutating: do not sort `tasks` in place because the
  // parent passes a memoised array.
  const orderedTasks = showOwner && currentUserEmail
    ? [...tasks].sort((a, b) => {
        const aMine = a.owner_id === currentUserEmail ? 0 : 1;
        const bMine = b.owner_id === currentUserEmail ? 0 : 1;
        return aMine - bMine;
      })
    : tasks;

  return (
    <ul className="flex flex-col gap-2">
      {orderedTasks.map((task) => {
        const isSelected = task.id === selectedTaskId;
        const isBusy = busyIds.has(task.id);
        return (
          <li key={task.id}>
            <div
              className={cn(
                "rounded-lg border bg-card text-card-foreground transition-colors",
                isSelected ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-primary/40",
                !task.enabled && "opacity-60",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(task)}
                className="w-full text-left px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold truncate text-foreground">
                        {task.name}
                      </h3>
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                        {task.id}
                      </Badge>
                      {!task.enabled && (
                        <Badge variant="secondary" className="shrink-0 text-[10px] uppercase">
                          disabled
                        </Badge>
                      )}
                      {/* Spec #099 FR-003: pre-flight ack badge so operators
                          see "did the supervisor accept this task?" at a glance.
                          Tooltip carries the detail + dry-run summary. */}
                      {(() => {
                        const a = ackBadgeFor(task.last_ack);
                        return (
                          <Badge
                            variant="outline"
                            className={cn("shrink-0 text-[10px] gap-1", a.className)}
                            title={ackTooltip(task.last_ack)}
                            data-testid={`autonomous-ack-${a.status}`}
                          >
                            {a.icon}
                            {a.label}
                          </Badge>
                        );
                      })()}
                    </div>
                    {task.description && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {task.description}
                      </p>
                    )}
                    {showOwner && task.owner_id && (
                      <p
                        className="mt-1 text-[11px] text-muted-foreground"
                        data-testid="autonomous-task-owner"
                      >
                        Owner: <span className="font-mono">{task.owner_id}</span>
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <TriggerIcon type={task.trigger.type} />
                        {describeTrigger(task.trigger)}
                      </span>
                      {task.dynamic_agent_id ? (
                        // Custom (dynamic) agent route: this task runs
                        // through the dynamic-agents service against
                        // the user's own agent rather than the
                        // supervisor. Render with a distinct label so
                        // operators can immediately tell dynamic-agent
                        // rows from MAS-subagent rows -- otherwise the
                        // routing target was easy to confuse with a
                        // supervisor sub-agent id.
                        <span>
                          custom:{" "}
                          <code className="text-[11px]">
                            {task.dynamic_agent_id}
                          </code>
                        </span>
                      ) : (
                        <span>
                          agent:{" "}
                          <code className="text-[11px]">
                            {task.agent ?? "auto"}
                          </code>
                        </span>
                      )}
                      {/* Spec #099 FR-010 / FR-012: absolute + relative next-run
                          rendering so "will it run soon?" is answerable at a glance. */}
                      <span title={task.next_run ? new Date(task.next_run).toISOString() : ""}>
                        next: {formatNextRun(task.next_run)}
                        {task.next_run && (
                          <span className="ml-1 text-[10px] text-muted-foreground/80">
                            ({formatRelative(task.next_run)})
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
              {/* Plan section 4.3 — action toolbar is always rendered.
                  Backend `_assert_task_access` enforces per-task ownership
                  for non-owners; per-task handlers surface 403s as toasts
                  (defence in depth). */}
              <div
                className="flex items-center justify-end gap-1 border-t border-border px-2 py-1.5"
                data-testid="autonomous-task-actions"
              >
                {/* Spec #099 FR-006 / Story 2: deep-link to the per-task
                      chat conversation. Stable UUIDv5 so the link works
                      even before the first run has fired. Open in a new
                      tab so the operator can keep the autonomous list
                      visible alongside the conversation. */}
                  {task.chat_conversation_id && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      asChild
                      onClick={(e) => e.stopPropagation()}
                      title="View this task's chat thread"
                    >
                      <Link
                        href={`/chat/${task.chat_conversation_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="autonomous-thread-link"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span className="ml-1 text-xs">Thread</span>
                      </Link>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTrigger(task);
                    }}
                    disabled={isBusy || !task.enabled}
                    title={task.enabled ? "Run now" : "Enable the task to run it"}
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span className="ml-1 text-xs">Run</span>
                  </Button>
                  {/* Edit slot. `onToggleEnabled` (admin oversight) takes
                      precedence and renders a clear Pause/Resume control;
                      otherwise the pencil opens the edit form. */}
                  {onToggleEnabled ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleEnabled(task);
                      }}
                      disabled={isBusy}
                      title={task.enabled ? "Pause this task" : "Resume this task"}
                    >
                      {task.enabled ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <CirclePlay className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1 text-xs">{task.enabled ? "Pause" : "Resume"}</span>
                    </Button>
                  ) : (
                    onEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(task);
                        }}
                        disabled={isBusy}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span className="ml-1 text-xs">Edit</span>
                      </Button>
                    )
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(task);
                    }}
                    disabled={isBusy}
                    className="text-red-600 hover:text-red-700 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="ml-1 text-xs">Delete</span>
                  </Button>
                </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
