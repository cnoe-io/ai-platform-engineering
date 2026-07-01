// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

"use client";

import React, { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDynamicAgents } from "@/hooks/use-dynamic-agents";

import type { AutonomousTask, TaskFormState, TriggerType } from "./types";
import { fromFormState, toFormState } from "./formState";

const WEBHOOK_PROVIDER_OPTIONS = [
  { value: "generic_hmac", label: "Generic HMAC" },
  { value: "github", label: "GitHub" },
  { value: "jira", label: "Jira" },
  { value: "slack", label: "Slack" },
  { value: "pagerduty", label: "PagerDuty" },
];

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided we render in "edit" mode. */
  task?: AutonomousTask | null;
  /**
   * Pre-select this dynamic agent in *create* mode (e.g. launched from an
   * agent row's "+ Add autonomous task"). Ignored when `task` is provided
   * (edit mode round-trips the task's own agent).
   */
  initialAgentId?: string | null;
  onSubmit: (task: AutonomousTask) => Promise<void>;
}

function seededFormState(
  task: AutonomousTask | null | undefined,
  initialAgentId: string | null | undefined,
): TaskFormState {
  const state = toFormState(task);
  if (!task && initialAgentId) {
    state.dynamic_agent_id = initialAgentId;
  }
  return state;
}

export function TaskFormDialog({ open, onOpenChange, task, initialAgentId, onSubmit }: TaskFormDialogProps) {
  const isEdit = Boolean(task);
  const [form, setForm] = useState<TaskFormState>(() => seededFormState(task, initialAgentId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { agents: agentOptions, loading: agentsLoading, error: agentsError } = useDynamicAgents();

  // Reset whenever the dialog opens or the underlying task changes.
  // Without this, editing task A then opening "create" would inherit
  // A's fields.
  useEffect(() => {
    if (open) {
      setForm(seededFormState(task, initialAgentId));
      setError(null);
      setSubmitting(false);
    }
  }, [open, task, initialAgentId]);

  const update = <K extends keyof TaskFormState>(key: K, value: TaskFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const triggerOptions = useMemo<TriggerType[]>(() => ["cron", "interval", "webhook"], []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    // Every autonomous task must target a dynamic agent (the dynamic-agents
    // runtime is the only execution backend; the backend rejects creates
    // without one). Enforce it here so the operator gets immediate feedback
    // instead of a round-trip 400.
    if (!form.dynamic_agent_id) {
      setError("Select a dynamic agent for this task.");
      return;
    }
    const result = fromFormState(form);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(result.task);
      onOpenChange(false);
    } catch (err) {
      // Mirror the API client's error shape — `.message` already
      // carries the FastAPI ``detail`` string when available.
      setError(err instanceof Error ? err.message : "Failed to save task.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit task" : "New autonomous task"}</DialogTitle>
          <DialogDescription>
            Tasks are scheduled via the autonomous-agents service and dispatched to
            CAIPE supervisor over A2A. Cron and interval tasks fire automatically;
            webhook tasks fire when a POST hits{" "}
            <code className="text-xs">/api/v1/hooks/{form.id || "<id>"}</code>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="task-id">ID</Label>
              <Input
                id="task-id"
                value={form.id}
                onChange={(e) => update("id", e.target.value)}
                placeholder="daily-incident-summary"
                disabled={isEdit}
                required
              />
              {isEdit && (
                <p className="text-[11px] text-muted-foreground">
                  ID is immutable after creation.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-name">Name</Label>
              <Input
                id="task-name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Daily Incident Summary"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="task-description">Description</Label>
            <Input
              id="task-description"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="What does this task do?"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="task-agent">Dynamic agent</Label>
              {agentsError ? (
                <p className="text-[11px] text-destructive">
                  Could not load dynamic agents. Create one in the Custom
                  Agents tab, then retry.
                </p>
              ) : (
                // Use the active theme's `--background` / `--foreground`
                // tokens so the control matches the dialog body in every
                // theme. Browsers ignore most CSS on <option>, so we read the
                // same CSS variables via inline style with hsl(var(--…)).
                <select
                  id="task-agent"
                  value={form.dynamic_agent_id ?? ""}
                  onChange={(e) =>
                    update("dynamic_agent_id", e.target.value || null)
                  }
                  disabled={agentsLoading}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option
                    value=""
                    style={{
                      backgroundColor: "hsl(var(--background))",
                      color: "hsl(var(--foreground))",
                    }}
                  >
                    {agentsLoading ? "Loading agents…" : "Select a dynamic agent…"}
                  </option>
                  {agentOptions.map((opt) => (
                    <option
                      key={opt.id}
                      value={opt.id}
                      style={{
                        backgroundColor: "hsl(var(--background))",
                        color: "hsl(var(--foreground))",
                      }}
                    >
                      {opt.name}
                    </option>
                  ))}
                  {/* Preserve a stored agent id that's no longer listed (e.g.
                      the agent was deleted or the caller lost access) so
                      editing the task doesn't silently drop it. */}
                  {form.dynamic_agent_id &&
                    !agentOptions.some((opt) => opt.id === form.dynamic_agent_id) && (
                      <option
                        value={form.dynamic_agent_id}
                        style={{
                          backgroundColor: "hsl(var(--background))",
                          color: "hsl(var(--foreground))",
                        }}
                      >
                        {form.dynamic_agent_id} (not currently available)
                      </option>
                    )}
                </select>
              )}
              <p className="text-[11px] text-muted-foreground">
                Required. The task prompt runs through this dynamic agent (its
                tools, system prompt and model). Manage agents in the Custom
                Agents tab.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-llm">LLM provider (optional)</Label>
              <Input
                id="task-llm"
                value={form.llm_provider}
                onChange={(e) => update("llm_provider", e.target.value)}
                placeholder="anthropic"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="task-prompt">Prompt</Label>
            <Textarea
              id="task-prompt"
              value={form.prompt}
              onChange={(e) => update("prompt", e.target.value)}
              rows={4}
              placeholder="Summarise yesterday's incidents and post to #ops."
              required
            />
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <Label>Trigger</Label>
            <div className="flex gap-2">
              {triggerOptions.map((opt) => (
                <button
                  type="button"
                  key={opt}
                  onClick={() => update("triggerType", opt)}
                  className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                    form.triggerType === opt
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-foreground border-border hover:bg-muted"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>

            {form.triggerType === "cron" && (
              <div className="space-y-1">
                <Label htmlFor="task-cron">Schedule (cron)</Label>
                <Input
                  id="task-cron"
                  value={form.cronSchedule}
                  onChange={(e) => update("cronSchedule", e.target.value)}
                  placeholder="0 9 * * *"
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Standard 5-field cron expression (minute hour dom month dow).
                </p>
              </div>
            )}

            {form.triggerType === "interval" && (
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="task-interval-seconds">Seconds</Label>
                  <Input
                    id="task-interval-seconds"
                    value={form.intervalSeconds}
                    onChange={(e) => update("intervalSeconds", e.target.value)}
                    inputMode="numeric"
                    placeholder=""
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="task-interval-minutes">Minutes</Label>
                  <Input
                    id="task-interval-minutes"
                    value={form.intervalMinutes}
                    onChange={(e) => update("intervalMinutes", e.target.value)}
                    inputMode="numeric"
                    placeholder=""
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="task-interval-hours">Hours</Label>
                  <Input
                    id="task-interval-hours"
                    value={form.intervalHours}
                    onChange={(e) => update("intervalHours", e.target.value)}
                    inputMode="numeric"
                    placeholder="1"
                  />
                </div>
              </div>
            )}

            {form.triggerType === "webhook" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="task-webhook-provider">Provider</Label>
                  <select
                    id="task-webhook-provider"
                    value={form.webhookProvider}
                    onChange={(e) => update("webhookProvider", e.target.value)}
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
                  <Label htmlFor="task-webhook-secret">HMAC secret (optional)</Label>
                  <Input
                    id="task-webhook-secret"
                    value={form.webhookSecret}
                    onChange={(e) => update("webhookSecret", e.target.value)}
                    type="password"
                    placeholder={
                      isEdit && task?.trigger.type === "webhook" && task.trigger.has_secret
                        ? "secret already configured — type to replace"
                        : "leave blank to accept unsigned payloads"
                    }
                  />
                  {isEdit && task?.trigger.type === "webhook" && task.trigger.has_secret && (
                    <p className="text-xs text-muted-foreground">
                      The existing secret is hidden for security. Leave this field blank to keep it unchanged.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="task-timeout">Timeout (seconds, optional)</Label>
              <Input
                id="task-timeout"
                value={form.timeoutSeconds}
                onChange={(e) => update("timeoutSeconds", e.target.value)}
                inputMode="decimal"
                placeholder="defaults to A2A_TIMEOUT_SECONDS"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-retries">Max retries (optional)</Label>
              <Input
                id="task-retries"
                value={form.maxRetries}
                onChange={(e) => update("maxRetries", e.target.value)}
                inputMode="numeric"
                placeholder="defaults to A2A_MAX_RETRIES"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => update("enabled", e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Enabled
          </label>

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
