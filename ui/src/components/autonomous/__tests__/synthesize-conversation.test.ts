// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for the routing-target propagation in
 * ``synthesizeConversationForTask``. Custom-agent tasks now stamp
 * ``dynamic_agent_id`` (and clear ``agent``) -- the synthesised
 * conversation must carry that id as the agent participant so the
 * sidebar's agent-name suffix lights up and ``ChatContainer.getAgentId``
 * routes the thread back to the dynamic agent on click.
 */

import { synthesizeConversationForTask } from "../synthesize-conversation";
import { getAgentId } from "@/types/a2a";
import type { AutonomousTask, TaskRun } from "../types";

function baseTask(overrides: Partial<AutonomousTask> = {}): AutonomousTask {
  return {
    id: "t1",
    name: "My scheduled thing",
    description: null,
    agent: null,
    prompt: "do the thing",
    llm_provider: null,
    trigger: { type: "cron", schedule: "0 9 * * *" },
    enabled: true,
    timeout_seconds: null,
    max_retries: null,
    ...overrides,
  };
}

function baseRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    run_id: "run-1",
    task_id: "t1",
    task_name: "My scheduled thing",
    status: "success",
    started_at: "2026-05-13T10:00:00.000Z",
    finished_at: "2026-05-13T10:01:00.000Z",
    response_preview: "done",
    response_full: "done",
    events: [],
    ...overrides,
  };
}

describe("synthesizeConversationForTask", () => {
  it("uses dynamic_agent_id as the agent participant for custom-agent tasks", () => {
    const conv = synthesizeConversationForTask(
      baseTask({ agent: null, dynamic_agent_id: "my_custom_agent" }),
      [],
    );

    expect(getAgentId(conv)).toBe("my_custom_agent");
    expect(conv.source).toBe("autonomous");
    expect(conv.task_id).toBe("t1");
  });

  it("falls back to agent for legacy supervisor tasks", () => {
    // Pre-rename tasks that route through the supervisor still use
    // ``agent`` (e.g. "github") and have no ``dynamic_agent_id`` -- the
    // synthesised conversation must keep surfacing that as the agent
    // participant so the existing routing path keeps working.
    const conv = synthesizeConversationForTask(
      baseTask({ agent: "github", dynamic_agent_id: null }),
      [],
    );

    expect(getAgentId(conv)).toBe("github");
  });

  it("yields no agent participant when both routing fields are blank", () => {
    // Sanity guard for the LLM-router-picks-it case (neither hint
    // provided): ``buildParticipants(undefined)`` produces an empty
    // participants list and ``getAgentId`` is therefore undefined.
    const conv = synthesizeConversationForTask(
      baseTask({ agent: null, dynamic_agent_id: null }),
      [],
    );

    expect(getAgentId(conv)).toBeUndefined();
  });

  it("renders follow-up runs as a concise user-facing prompt", () => {
    const conv = synthesizeConversationForTask(
      baseTask({ prompt: "base task prompt" }),
      [
        baseRun({
          parent_run_id: "run-original",
          request_prompt:
            "base task prompt\n\nOperator follow-up (webex, from alice@example.com, in reply to run run-original):\nstill failing",
        }),
      ],
    );

    const request = conv.messages.find((m) => m.id === "run:run-1:request");
    expect(request?.content).toBe("Webex Follow-up: still failing");
  });

  it("falls back to the task prompt for legacy runs without request_prompt", () => {
    const conv = synthesizeConversationForTask(
      baseTask({ prompt: "base task prompt" }),
      [baseRun()],
    );

    const request = conv.messages.find((m) => m.id === "run:run-1:request");
    expect(request?.content).toBe("base task prompt");
  });
});
