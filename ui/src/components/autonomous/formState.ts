// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

/**
 * Pure converters between the wire-level ``AutonomousTask`` model and the
 * free-text ``TaskFormState`` used by form UIs.
 *
 * Extracted from ``TaskFormDialog.tsx`` so both the standalone task
 * dialog and the Autonomous step inside the Custom Agent wizard share
 * the exact same cron / interval / webhook parsing + validation logic.
 */

import type { AutonomousTask, TaskFormState } from "./types";

export const EMPTY_FORM: TaskFormState = {
  id: "",
  name: "",
  description: "",
  agent: "",
  prompt: "",
  llm_provider: "",
  enabled: true,
  triggerType: "cron",
  cronSchedule: "0 9 * * *",
  intervalSeconds: "",
  intervalMinutes: "",
  intervalHours: "",
  webhookProvider: "github",
  webhookSecret: "",
  timeoutSeconds: "",
  maxRetries: "",
};

/** Convert API model -> form state. */
export function toFormState(task: AutonomousTask | null | undefined): TaskFormState {
  if (!task) return { ...EMPTY_FORM };
  const base: TaskFormState = {
    ...EMPTY_FORM,
    id: task.id,
    name: task.name,
    description: task.description ?? "",
    agent: task.agent ?? "",
    prompt: task.prompt,
    llm_provider: task.llm_provider ?? "",
    enabled: task.enabled,
    triggerType: task.trigger.type,
    timeoutSeconds: task.timeout_seconds == null ? "" : String(task.timeout_seconds),
    maxRetries: task.max_retries == null ? "" : String(task.max_retries),
  };
  if (task.trigger.type === "cron") {
    base.cronSchedule = task.trigger.schedule;
  } else if (task.trigger.type === "interval") {
    base.intervalSeconds = task.trigger.seconds == null ? "" : String(task.trigger.seconds);
    base.intervalMinutes = task.trigger.minutes == null ? "" : String(task.trigger.minutes);
    base.intervalHours = task.trigger.hours == null ? "" : String(task.trigger.hours);
  } else {
    base.webhookProvider = task.trigger.provider ?? "github";
    // Backend never echoes the secret on read paths -- only the
    // ``has_secret`` boolean comes back. Leave the form blank so the
    // operator must explicitly type a new value to *change* it.
    base.webhookSecret = "";
  }
  return base;
}

export type FormConversionResult =
  | { task: AutonomousTask }
  | { error: string };

/**
 * Convert form state -> API model. Returns ``{ error }`` when inputs
 * are invalid so the caller can surface a human-readable message.
 */
export function fromFormState(form: TaskFormState): FormConversionResult {
  const id = form.id.trim();
  const name = form.name.trim();
  const agent = form.agent.trim();
  const prompt = form.prompt.trim();

  if (!id) return { error: "ID is required." };
  if (!name) return { error: "Name is required." };
  if (!prompt) return { error: "Prompt is required." };
  // Spec #099 FR-001: agent is a HINT, not a hard requirement. Lock the
  // id down to the same character set the FastAPI side accepts in path
  // parameters so spaces and other foot-guns are caught client-side.
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return { error: "ID may only contain letters, digits, '-' and '_'." };
  }

  let trigger: AutonomousTask["trigger"];
  if (form.triggerType === "cron") {
    if (!form.cronSchedule.trim()) return { error: "Cron schedule is required." };
    trigger = { type: "cron", schedule: form.cronSchedule.trim() };
  } else if (form.triggerType === "interval") {
    const parseField = (raw: string): number | null => {
      const v = raw.trim();
      if (!v) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        return Number.NaN;
      }
      return n;
    };
    const seconds = parseField(form.intervalSeconds);
    const minutes = parseField(form.intervalMinutes);
    const hours = parseField(form.intervalHours);
    if ([seconds, minutes, hours].some((v) => Number.isNaN(v))) {
      return { error: "Interval values must be positive whole numbers." };
    }
    if (seconds == null && minutes == null && hours == null) {
      return { error: "Interval requires at least one of seconds / minutes / hours." };
    }
    trigger = {
      type: "interval",
      seconds: seconds ?? null,
      minutes: minutes ?? null,
      hours: hours ?? null,
    };
  } else {
    const provider = form.webhookProvider.trim() || "github";
    trigger = {
      type: "webhook",
      provider,
      // Treat empty input as "no secret" rather than "empty secret" --
      // the latter would be (correctly) rejected by HMAC validation.
      secret: form.webhookSecret.trim() ? form.webhookSecret.trim() : null,
    };
  }

  let timeoutSeconds: number | null = null;
  if (form.timeoutSeconds.trim()) {
    const n = Number(form.timeoutSeconds);
    if (!Number.isFinite(n) || n <= 0) {
      return { error: "Timeout must be a positive number of seconds." };
    }
    timeoutSeconds = n;
  }

  let maxRetries: number | null = null;
  if (form.maxRetries.trim()) {
    const n = Number(form.maxRetries);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return { error: "Max retries must be a non-negative integer." };
    }
    maxRetries = n;
  }

  const task: AutonomousTask = {
    id,
    name,
    description: form.description.trim() || null,
    // Empty agent => null on the wire (FR-001: agent is optional hint).
    agent: agent || null,
    prompt,
    llm_provider: form.llm_provider.trim() || null,
    trigger,
    enabled: form.enabled,
    timeout_seconds: timeoutSeconds,
    max_retries: maxRetries,
  };
  return { task };
}

/**
 * Human-readable summary of a trigger, used in list views. Keeps the
 * summary logic next to the converters so new trigger types only need
 * to be added in one place.
 */
export function summarizeTrigger(trigger: AutonomousTask["trigger"]): string {
  if (trigger.type === "cron") {
    return `Cron: ${trigger.schedule}`;
  }
  if (trigger.type === "interval") {
    const parts: string[] = [];
    if (trigger.hours) parts.push(`${trigger.hours}h`);
    if (trigger.minutes) parts.push(`${trigger.minutes}m`);
    if (trigger.seconds) parts.push(`${trigger.seconds}s`);
    return parts.length > 0 ? `Every ${parts.join(" ")}` : "Interval (unset)";
  }
  const provider = trigger.provider ?? "github";
  return trigger.has_secret ? `Webhook: ${provider} (signed)` : `Webhook: ${provider}`;
}
