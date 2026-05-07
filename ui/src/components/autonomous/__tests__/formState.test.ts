// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

import type { AutonomousTask } from "../types";
import { EMPTY_FORM, fromFormState, summarizeTrigger, toFormState } from "../formState";

describe("formState.toFormState", () => {
  it("returns a blank form when task is null", () => {
    expect(toFormState(null)).toEqual(EMPTY_FORM);
  });

  it("maps a cron task to form fields", () => {
    const task: AutonomousTask = {
      id: "nightly",
      name: "Nightly",
      description: "desc",
      agent: "github",
      prompt: "summarise",
      llm_provider: "anthropic",
      trigger: { type: "cron", schedule: "0 0 * * *" },
      enabled: false,
      timeout_seconds: 30,
      max_retries: 2,
    };
    expect(toFormState(task)).toEqual(
      expect.objectContaining({
        id: "nightly",
        triggerType: "cron",
        cronSchedule: "0 0 * * *",
        enabled: false,
        timeoutSeconds: "30",
        maxRetries: "2",
      }),
    );
  });

  it("maps an interval task to form fields", () => {
    const task: AutonomousTask = {
      id: "every_15",
      name: "N",
      agent: null,
      prompt: "p",
      trigger: { type: "interval", seconds: null, minutes: 15, hours: null },
      enabled: true,
    };
    expect(toFormState(task)).toEqual(
      expect.objectContaining({
        triggerType: "interval",
        intervalSeconds: "",
        intervalMinutes: "15",
        intervalHours: "",
      }),
    );
  });

  it("maps webhook provider and leaves secret blank even when has_secret=true on the server", () => {
    const task: AutonomousTask = {
      id: "hook",
      name: "N",
      agent: null,
      prompt: "p",
      trigger: { type: "webhook", provider: "jira", has_secret: true },
      enabled: true,
    };
    expect(toFormState(task)).toEqual(
      expect.objectContaining({
        webhookProvider: "jira",
        webhookSecret: "",
      }),
    );
  });
});

describe("formState.fromFormState", () => {
  const base = {
    ...EMPTY_FORM,
    id: "my_task",
    name: "My task",
    prompt: "do thing",
  };

  it("requires id, name, prompt", () => {
    expect(fromFormState({ ...base, id: "" })).toEqual({ error: expect.stringMatching(/ID/) });
    expect(fromFormState({ ...base, name: "" })).toEqual({ error: expect.stringMatching(/Name/) });
    expect(fromFormState({ ...base, prompt: "" })).toEqual({ error: expect.stringMatching(/Prompt/) });
  });

  it("rejects ids with invalid characters", () => {
    expect(fromFormState({ ...base, id: "has space" })).toEqual({
      error: expect.stringMatching(/ID may only contain/),
    });
  });

  it("parses a valid cron task", () => {
    const result = fromFormState({ ...base, triggerType: "cron", cronSchedule: "*/5 * * * *" });
    expect(result).toEqual({
      task: expect.objectContaining({
        id: "my_task",
        trigger: { type: "cron", schedule: "*/5 * * * *" },
      }),
    });
  });

  it("rejects empty cron schedule", () => {
    expect(
      fromFormState({ ...base, triggerType: "cron", cronSchedule: "   " }),
    ).toEqual({ error: expect.stringMatching(/Cron schedule/) });
  });

  it("requires at least one interval field", () => {
    expect(fromFormState({ ...base, triggerType: "interval" })).toEqual({
      error: expect.stringMatching(/at least one/),
    });
  });

  it("rejects non-positive / non-integer interval values", () => {
    expect(
      fromFormState({ ...base, triggerType: "interval", intervalMinutes: "-5" }),
    ).toEqual({ error: expect.stringMatching(/positive whole numbers/) });
    expect(
      fromFormState({ ...base, triggerType: "interval", intervalMinutes: "1.5" }),
    ).toEqual({ error: expect.stringMatching(/positive whole numbers/) });
  });

  it("maps webhook with blank secret to null", () => {
    const result = fromFormState({ ...base, triggerType: "webhook", webhookSecret: "   " });
    expect(result).toEqual({
      task: expect.objectContaining({
        trigger: { type: "webhook", provider: "github", secret: null },
      }),
    });
  });

  it("maps webhook provider and secret verbatim", () => {
    const result = fromFormState({
      ...base,
      triggerType: "webhook",
      webhookProvider: "jira",
      webhookSecret: "s3cret",
    });
    expect(result).toEqual({
      task: expect.objectContaining({
        trigger: { type: "webhook", provider: "jira", secret: "s3cret" },
      }),
    });
  });

  it("parses optional timeout and maxRetries", () => {
    const result = fromFormState({
      ...base,
      triggerType: "cron",
      cronSchedule: "0 9 * * *",
      timeoutSeconds: "60",
      maxRetries: "3",
    });
    expect(result).toEqual({
      task: expect.objectContaining({ timeout_seconds: 60, max_retries: 3 }),
    });
  });

  it("rejects invalid timeout and maxRetries", () => {
    expect(
      fromFormState({ ...base, triggerType: "cron", cronSchedule: "0 9 * * *", timeoutSeconds: "-1" }),
    ).toEqual({ error: expect.stringMatching(/Timeout/) });
    expect(
      fromFormState({ ...base, triggerType: "cron", cronSchedule: "0 9 * * *", maxRetries: "1.5" }),
    ).toEqual({ error: expect.stringMatching(/Max retries/) });
  });

  it("converts empty agent to null", () => {
    const result = fromFormState({ ...base, triggerType: "cron", cronSchedule: "0 9 * * *", agent: "" });
    expect(result).toEqual({ task: expect.objectContaining({ agent: null }) });
  });
});

describe("formState.summarizeTrigger", () => {
  it("summarises cron", () => {
    expect(summarizeTrigger({ type: "cron", schedule: "0 9 * * *" })).toBe("Cron: 0 9 * * *");
  });
  it("summarises interval", () => {
    expect(
      summarizeTrigger({ type: "interval", seconds: null, minutes: 15, hours: 2 }),
    ).toBe("Every 2h 15m");
  });
  it("summarises webhook with/without secret", () => {
    expect(summarizeTrigger({ type: "webhook", provider: "jira", has_secret: true })).toBe("Webhook: jira (signed)");
    expect(summarizeTrigger({ type: "webhook", has_secret: false })).toBe("Webhook: github");
  });
});
