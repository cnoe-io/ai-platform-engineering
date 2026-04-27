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
import { cn } from "@/lib/utils";
import { useAgentTools } from "@/hooks/use-agent-tools";

import type { AutonomousTask, TaskFormState, TriggerType } from "./types";
import { fromFormState, toFormState } from "./formState";

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided we render in "edit" mode. */
  task?: AutonomousTask | null;
  onSubmit: (task: AutonomousTask) => Promise<void>;
}

export function TaskFormDialog({ open, onOpenChange, task, onSubmit }: TaskFormDialogProps) {
  const isEdit = Boolean(task);
  const [form, setForm] = useState<TaskFormState>(() => toFormState(task));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pull the live list of subagents discovered by the supervisor so the
  // operator can pick one from a dropdown instead of free-typing the
  // identifier (which is a foot-gun -- typos silently fall back to the
  // LLM router). The "user_input" pseudo-agent is filtered out because
  // autonomous tasks don't have a human in the loop.
  const {
    agents: agentOptions,
    loading: agentsLoading,
    error: agentsError,
  } = useAgentTools();

  // Reset whenever the dialog opens or the underlying task changes.
  // Without this, editing task A then opening "create" would inherit
  // A's fields.
  useEffect(() => {
    if (open) {
      setForm(toFormState(task));
      setError(null);
      setSubmitting(false);
    }
  }, [open, task]);

  const update = <K extends keyof TaskFormState>(key: K, value: TaskFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const triggerOptions = useMemo<TriggerType[]>(() => ["cron", "interval", "webhook"], []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
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
              <Label htmlFor="task-agent">Agent (optional)</Label>
              <select
                id="task-agent"
                value={form.agent}
                onChange={(e) => update("agent", e.target.value)}
                disabled={agentsLoading}
                className={cn(
                  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
                  "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <option value="">
                  {agentsLoading
                    ? "Loading agents…"
                    : "(LLM router will choose)"}
                </option>
                {/* Filter out "user_input" — autonomous tasks run without a
                    human in the loop so that pseudo-agent is meaningless
                    here. If the live discovery fails, still surface the
                    persisted value so editing an existing task doesn't
                    silently drop its routing hint. */}
                {agentOptions
                  .filter((opt) => opt.value !== "user_input")
                  .map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                {form.agent &&
                  !agentOptions.some((opt) => opt.value === form.agent) && (
                    <option value={form.agent}>{form.agent} (custom)</option>
                  )}
              </select>
              <p className="text-[11px] text-muted-foreground">
                {agentsError ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    Could not load live agents from the supervisor. You can
                    still leave this blank to let the LLM router decide.
                  </span>
                ) : (
                  <>
                    Optional routing hint. Leave as{" "}
                    <em>(LLM router will choose)</em> and the supervisor picks
                    an agent from the prompt at run time.
                  </>
                )}
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
