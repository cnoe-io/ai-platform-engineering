// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

"use client";

import React from "react";
import Link from "next/link";
import { Pencil, Play, Trash2, Webhook, Clock, Repeat, CheckCircle2, AlertTriangle, XCircle, Loader2, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Acknowledgement, AcknowledgementStatus, AutonomousTask, Trigger } from "./types";

interface TaskListProps {
  tasks: AutonomousTask[];
  selectedTaskId: string | null;
  onSelect: (task: AutonomousTask) => void;
  onEdit: (task: AutonomousTask) => void;
  onDelete: (task: AutonomousTask) => void;
  onTrigger: (task: AutonomousTask) => void;
  /** ids that are currently being acted on (delete/trigger) — used to grey out buttons. */
  busyIds: Set<string>;
  /**
   * IMP-19: when true, the per-task action toolbar (Run / Edit /
   * Delete) is hidden entirely. Used for the read-only operator
   * view -- the proxy will 403 these mutations server-side anyway,
   * but rendering buttons that always 403 is hostile UX.
   */
  readOnly?: boolean;
}

function describeTrigger(trigger: Trigger): string {
  if (trigger.type === "cron") return `cron · ${trigger.schedule}`;
  if (trigger.type === "interval") {
    const parts: string[] = [];
    if (trigger.hours) parts.push(`${trigger.hours}h`);
    if (trigger.minutes) parts.push(`${trigger.minutes}m`);
    if (trigger.seconds) parts.push(`${trigger.seconds}s`);
    return `every ${parts.join(" ") || "—"}`;
  }
  return `webhook · ${trigger.provider ?? "github"}`;
}

function TriggerIcon({ type }: { type: Trigger["type"] }) {
  if (type === "cron") return <Clock className="h-3.5 w-3.5" />;
  if (type === "interval") return <Repeat className="h-3.5 w-3.5" />;
  return <Webhook className="h-3.5 w-3.5" />;
}

function formatNextRun(value?: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

/** Human-readable relative offset, e.g. "in 4h" or "5m ago". Spec #099 FR-012. */
function formatRelative(value?: string | null, nowMs: number = Date.now()): string {
  if (!value) return "";
  try {
    const t = new Date(value).getTime();
    const deltaSec = Math.round((t - nowMs) / 1000);
    const abs = Math.abs(deltaSec);
    const future = deltaSec >= 0;
    let unit: string;
    let n: number;
    if (abs < 60) { unit = "s"; n = abs; }
    else if (abs < 3600) { unit = "m"; n = Math.round(abs / 60); }
    else if (abs < 86400) { unit = "h"; n = Math.round(abs / 3600); }
    else { unit = "d"; n = Math.round(abs / 86400); }
    return future ? `in ${n}${unit}` : `${n}${unit} ago`;
  } catch {
    return "";
  }
}

/**
 * Visual treatment for the per-task pre-flight badge. Maps the four
 * Acknowledgement statuses to icon + color + label so the row reads at
 * a glance: green check for "ack ok", yellow triangle for "warn",
 * red x for "failed", grey spinner for "pending".
 */
function ackBadgeFor(ack?: Acknowledgement | null): {
  label: string;
  className: string;
  icon: React.ReactNode;
  status: AcknowledgementStatus | "absent";
} {
  if (!ack) {
    return {
      label: "Ack pending",
      className: "border-muted-foreground/30 text-muted-foreground",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      status: "absent",
    };
  }
  switch (ack.ack_status) {
    case "ok":
      return {
        label: "Ack OK",
        className: "border-green-600/40 text-green-600",
        icon: <CheckCircle2 className="h-3 w-3" />,
        status: "ok",
      };
    case "warn":
      return {
        label: "Ack warn",
        className: "border-yellow-600/40 text-yellow-700",
        icon: <AlertTriangle className="h-3 w-3" />,
        status: "warn",
      };
    case "failed":
      return {
        label: "Ack failed",
        className: "border-red-600/40 text-red-600",
        icon: <XCircle className="h-3 w-3" />,
        status: "failed",
      };
    case "pending":
    default:
      return {
        label: "Ack pending",
        className: "border-muted-foreground/30 text-muted-foreground",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        status: "pending",
      };
  }
}

/** Plain-text tooltip body assembled from the ack payload (newline-separated). */
function ackTooltip(ack?: Acknowledgement | null): string {
  if (!ack) return "Pre-flight not yet attempted.";
  const lines: string[] = [];
  if (ack.ack_detail) lines.push(ack.ack_detail);
  if (ack.routed_to) lines.push(`Routed to: ${ack.routed_to}`);
  if (ack.dry_run_summary) lines.push("", ack.dry_run_summary);
  return lines.join("\n");
}

export function TaskList({
  tasks,
  selectedTaskId,
  onSelect,
  onEdit,
  onDelete,
  onTrigger,
  busyIds,
  readOnly = false,
}: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
        {readOnly
          ? "No autonomous tasks configured yet."
          : 'No autonomous tasks yet. Click "New task" to create one.'}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((task) => {
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
              {!readOnly && (
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
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
