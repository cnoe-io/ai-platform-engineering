// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Pencil,
  Plus,
  Trash2,
  AlertCircle,
  Clock,
  Webhook as WebhookIcon,
  Calendar,
} from "lucide-react";
import type { AutonomousTask, TaskFormState, TriggerType } from "@/components/autonomous/types";
import {
  EMPTY_FORM,
  fromFormState,
  summarizeTrigger,
  toFormState,
} from "@/components/autonomous/formState";

export interface AutonomousTasksStepProps {
  /**
   * Slug id of the custom agent the tasks should be routed to. Empty
   * string on the create path until the user has typed a name — the
   * step still works, we just stamp the current value at save-time.
   */
  agentId: string;
  /** Draft task list owned by the parent editor. */
  tasks: AutonomousTask[];
  onChange: (tasks: AutonomousTask[]) => void;
  /** True while we're still fetching the existing task list. */
  loading?: boolean;
  /** Load error, if any. */
  error?: string | null;
  disabled?: boolean;
  /** True when this is a clone-from flow (show "not cloned" note). */
  isCloning?: boolean;
}

const TRIGGER_OPTIONS: { value: TriggerType; label: string; icon: React.ReactNode }[] = [
  { value: "cron", label: "Cron", icon: <Calendar className="h-3.5 w-3.5" /> },
  { value: "interval", label: "Interval", icon: <Clock className="h-3.5 w-3.5" /> },
  { value: "webhook", label: "Webhook", icon: <WebhookIcon className="h-3.5 w-3.5" /> },
];

const WEBHOOK_PROVIDER_OPTIONS = [
  { value: "github", label: "GitHub" },
  { value: "jira", label: "Jira" },
  { value: "slack", label: "Slack" },
  { value: "pagerduty", label: "PagerDuty" },
  { value: "generic_hmac", label: "Generic HMAC" },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function defaultTaskId(agentId: string, name: string, existing: AutonomousTask[]): string {
  const base = `${agentId || "agent"}__${slugify(name) || "task"}`;
  // Dedupe against existing ids so two "Daily summary" entries don't clash.
  const taken = new Set(existing.map((t) => t.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/** Inline editor for a single task draft. */
function TaskInlineEditor({
  initial,
  agentId,
  existingTasks,
  onSave,
  onCancel,
  disabled,
}: {
  initial: AutonomousTask | null;
  agentId: string;
  existingTasks: AutonomousTask[];
  onSave: (task: AutonomousTask) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const isEditing = Boolean(initial);
  const [form, setForm] = React.useState<TaskFormState>(() =>
    initial ? toFormState(initial) : { ...EMPTY_FORM },
  );
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [idTouched, setIdTouched] = React.useState(Boolean(initial));

  // Auto-generate an id from name/agent when creating, until the user
  // types their own. Avoids surprising the operator by stamping a new
  // id over one they deliberately edited.
  React.useEffect(() => {
    if (isEditing || idTouched) return;
    setForm((prev) => {
      const siblings = existingTasks.filter((t) => t.id !== prev.id);
      return { ...prev, id: defaultTaskId(agentId, prev.name, siblings) };
    });
  }, [agentId, form.name, isEditing, idTouched, existingTasks]);

  const update = <K extends keyof TaskFormState>(key: K, value: TaskFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    setLocalError(null);
    const result = fromFormState(form);
    if ("error" in result) {
      setLocalError(result.error);
      return;
    }
    // Disallow id collisions with siblings (excluding the task being edited).
    const clash = existingTasks.some(
      (t) => t.id === result.task.id && t.id !== initial?.id,
    );
    if (clash) {
      setLocalError(`A schedule with ID "${result.task.id}" already exists on this agent.`);
      return;
    }
    onSave(result.task);
  };

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-muted/20 p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="at-name">Schedule name</Label>
          <Input
            id="at-name"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Daily summary"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="at-id">Task ID</Label>
          <Input
            id="at-id"
            value={form.id}
            onChange={(e) => {
              setIdTouched(true);
              update("id", e.target.value);
            }}
            placeholder="agent__daily_summary"
            disabled={disabled || isEditing}
          />
          {isEditing ? (
            <p className="text-[11px] text-muted-foreground">IDs are immutable after creation.</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Must match <code>^[A-Za-z0-9_-]+$</code>. Auto-generated from the schedule name.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="at-description">Description (optional)</Label>
        <Input
          id="at-description"
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="What does this schedule do?"
          disabled={disabled}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="at-prompt">Prompt</Label>
        <Textarea
          id="at-prompt"
          value={form.prompt}
          onChange={(e) => update("prompt", e.target.value)}
          rows={3}
          placeholder="Summarise yesterday's incidents and post to #ops."
          disabled={disabled}
        />
        <p className="text-[11px] text-muted-foreground">
          This prompt is sent to the agent each time the trigger fires.
        </p>
      </div>

      <div className="space-y-2 rounded-md border border-border p-3">
        <Label>Trigger</Label>
        <div className="flex gap-2">
          {TRIGGER_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => update("triggerType", opt.value)}
              disabled={disabled}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 text-xs rounded-md border transition-colors",
                form.triggerType === opt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-border hover:bg-muted",
              )}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>

        {form.triggerType === "cron" && (
          <div className="space-y-1">
            <Label htmlFor="at-cron">Schedule (cron)</Label>
            <Input
              id="at-cron"
              value={form.cronSchedule}
              onChange={(e) => update("cronSchedule", e.target.value)}
              placeholder="0 9 * * *"
              disabled={disabled}
            />
            <p className="text-[11px] text-muted-foreground">
              Standard 5-field cron expression (minute hour dom month dow) in UTC.
            </p>
          </div>
        )}

        {form.triggerType === "interval" && (
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="at-int-s">Seconds</Label>
              <Input
                id="at-int-s"
                value={form.intervalSeconds}
                onChange={(e) => update("intervalSeconds", e.target.value)}
                inputMode="numeric"
                disabled={disabled}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="at-int-m">Minutes</Label>
              <Input
                id="at-int-m"
                value={form.intervalMinutes}
                onChange={(e) => update("intervalMinutes", e.target.value)}
                inputMode="numeric"
                disabled={disabled}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="at-int-h">Hours</Label>
              <Input
                id="at-int-h"
                value={form.intervalHours}
                onChange={(e) => update("intervalHours", e.target.value)}
                inputMode="numeric"
                placeholder="1"
                disabled={disabled}
              />
            </div>
          </div>
        )}

        {form.triggerType === "webhook" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="at-hook-provider">Provider</Label>
              <select
                id="at-hook-provider"
                value={form.webhookProvider}
                onChange={(e) => update("webhookProvider", e.target.value)}
                disabled={disabled}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {WEBHOOK_PROVIDER_OPTIONS.map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    style={{
                      backgroundColor: "hsl(var(--background))",
                      color: "hsl(var(--foreground))",
                    }}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="at-hook-secret">HMAC secret (optional)</Label>
              <Input
                id="at-hook-secret"
                value={form.webhookSecret}
                onChange={(e) => update("webhookSecret", e.target.value)}
                type="password"
                placeholder={
                  isEditing && initial?.trigger.type === "webhook" && initial.trigger.has_secret
                    ? "secret already configured — type to replace"
                    : "leave blank to accept unsigned payloads"
                }
                disabled={disabled}
              />
              {isEditing && initial?.trigger.type === "webhook" && initial.trigger.has_secret && (
                <p className="text-[11px] text-muted-foreground">
                  Existing secret is hidden for security. Leave blank to keep it unchanged.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="at-timeout">Timeout (seconds, optional)</Label>
          <Input
            id="at-timeout"
            value={form.timeoutSeconds}
            onChange={(e) => update("timeoutSeconds", e.target.value)}
            inputMode="decimal"
            placeholder="defaults to A2A_TIMEOUT_SECONDS"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="at-retries">Max retries (optional)</Label>
          <Input
            id="at-retries"
            value={form.maxRetries}
            onChange={(e) => update("maxRetries", e.target.value)}
            inputMode="numeric"
            placeholder="defaults to A2A_MAX_RETRIES"
            disabled={disabled}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => update("enabled", e.target.checked)}
          className="h-4 w-4 rounded border-border"
          disabled={disabled}
        />
        Enabled
      </label>

      {localError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {localError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={disabled}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleSave} disabled={disabled}>
          {isEditing ? "Update schedule" : "Add schedule"}
        </Button>
      </div>
    </div>
  );
}

export function AutonomousTasksStep({
  agentId,
  tasks,
  onChange,
  loading,
  error,
  disabled,
  isCloning,
}: AutonomousTasksStepProps) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [addingNew, setAddingNew] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const handleAdd = (task: AutonomousTask) => {
    onChange([...tasks, task]);
    setAddingNew(false);
  };

  const handleUpdate = (task: AutonomousTask) => {
    onChange(tasks.map((t) => (t.id === task.id ? task : t)));
    setEditingId(null);
  };

  const handleRemove = (id: string) => {
    onChange(tasks.filter((t) => t.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const handleToggleEnabled = (id: string, enabled: boolean) => {
    onChange(tasks.map((t) => (t.id === id ? { ...t, enabled } : t)));
  };

  const copyHookPath = async (taskId: string) => {
    // Store only the service-relative path because the FastAPI service
    // typically sits behind an operator-controlled hostname — we avoid
    // baking window.location.origin in so the copied value is
    // deployment-agnostic.
    const path = `/api/v1/hooks/${taskId}`;
    try {
      await navigator.clipboard.writeText(path);
      setCopiedId(taskId);
      setTimeout(() => setCopiedId((curr) => (curr === taskId ? null : curr)), 1500);
    } catch {
      // Swallow: clipboard permissions vary by browser; operator can
      // still read the path on screen.
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div>
        <Label>Autonomous schedules</Label>
        <p className="text-xs text-muted-foreground mb-2">
          Attach cron, interval, or webhook triggers that run this agent automatically. Each
          schedule sends its own prompt to the agent and records a run history visible in the
          Autonomous tab.
        </p>
        {isCloning && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>
              Schedules are not cloned from the source agent — task IDs must be unique, so
              re-create any schedules you need here.
            </span>
          </div>
        )}
      </div>

      {loading && (
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Loading existing schedules…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {tasks.length === 0 && !loading && !addingNew && (
        <div className="rounded-lg border border-dashed border-border bg-muted/10 p-6 text-center">
          <Clock className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium mb-1">No schedules yet</p>
          <p className="text-xs text-muted-foreground mb-3">
            Add a cron, interval, or webhook trigger to run this agent automatically.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAddingNew(true)}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add schedule
          </Button>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="space-y-2">
          {tasks.map((task) => {
            const isExpanded = editingId === task.id;
            return (
              <div
                key={task.id}
                className="rounded-lg border border-border bg-card"
              >
                <div className="flex items-start gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{task.name || task.id}</span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                          task.enabled
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {task.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {summarizeTrigger(task.trigger)}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      <code>{task.id}</code>
                      {task.description ? ` — ${task.description}` : null}
                    </p>
                    {task.trigger.type === "webhook" && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                          POST /api/v1/hooks/{task.id}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyHookPath(task.id)}
                          className="text-[10px] text-primary hover:underline inline-flex items-center gap-1"
                          disabled={disabled}
                          title="Copy webhook path (append to the autonomous-agents service host)"
                        >
                          <Copy className="h-3 w-3" />
                          {copiedId === task.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={task.enabled}
                        onChange={(e) => handleToggleEnabled(task.id, e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-border"
                        disabled={disabled}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditingId(isExpanded ? null : task.id)}
                      disabled={disabled}
                      title={isExpanded ? "Collapse" : "Edit"}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <Pencil className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleRemove(task.id)}
                      disabled={disabled}
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border p-3">
                    <TaskInlineEditor
                      initial={task}
                      agentId={agentId}
                      existingTasks={tasks}
                      onSave={handleUpdate}
                      onCancel={() => setEditingId(null)}
                      disabled={disabled}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {!addingNew && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddingNew(true)}
              disabled={disabled}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add another schedule
            </Button>
          )}
        </div>
      )}

      {addingNew && (
        <TaskInlineEditor
          initial={null}
          agentId={agentId}
          existingTasks={tasks}
          onSave={handleAdd}
          onCancel={() => setAddingNew(false)}
          disabled={disabled}
        />
      )}

      {tasks.length > 0 && !disabled && (
        <p className="text-[11px] text-muted-foreground">
          Changes to schedules are saved when you click {`"`}Save Changes{`"`} /
          {` "`}Create Agent{`"`} below.
        </p>
      )}
    </div>
  );
}
