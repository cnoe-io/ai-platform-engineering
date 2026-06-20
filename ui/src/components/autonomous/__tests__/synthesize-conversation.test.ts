// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for ``synthesizeConversationForTask`` and its helpers. Covers:
 *
 *  - Routing target: dynamic_agent_id vs agent.
 *  - Recency drift: ``updatedAt`` derives only from real lifecycle
 *    signals; marker timestamps are decorative (NEVER).
 *  - Id drift: canonical conversation id is uuid5 under the
 *    ``_AUTONOMOUS_NS`` namespace shared with
 *    ``services/chat_history.conversation_id_for_task``.
 *  - Marker UX preservation: disabled/webhook tasks still emit hints.
 *  - ``computeUpdatedAtFromSignals`` helper behaviour.
 */

import {
  NEVER,
  canonicalConversationId,
  computeUpdatedAtFromSignals,
  synthesizeConversationForTask,
} from "../synthesize-conversation";
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

describe("computeUpdatedAtFromSignals helper", () => {
  it("returns null when no runs and no last_ack", () => {
    expect(computeUpdatedAtFromSignals(baseTask(), [])).toBeNull();
  });

  it("returns latest run.finished_at when runs exist", () => {
    const t = computeUpdatedAtFromSignals(baseTask(), [
      baseRun({
        run_id: "r1",
        started_at: "2026-05-13T10:00:00.000Z",
        finished_at: "2026-05-13T10:01:00.000Z",
      }),
      baseRun({
        run_id: "r2",
        started_at: "2026-05-13T11:00:00.000Z",
        finished_at: "2026-05-13T11:05:00.000Z",
      }),
    ]);
    expect(t?.toISOString()).toBe("2026-05-13T11:05:00.000Z");
  });

  it("falls back to run.started_at when finished_at missing", () => {
    const t = computeUpdatedAtFromSignals(baseTask(), [
      baseRun({
        run_id: "r1",
        started_at: "2026-05-13T10:00:00.000Z",
        finished_at: null as unknown as string,
      }),
    ]);
    expect(t?.toISOString()).toBe("2026-05-13T10:00:00.000Z");
  });

  it("considers task.last_ack.ack_at alongside runs", () => {
    const t = computeUpdatedAtFromSignals(
      baseTask({
        last_ack: {
          ack_status: "ok",
          ack_at: "2026-05-13T12:00:00.000Z",
        } as AutonomousTask["last_ack"],
      }),
      [
        baseRun({
          started_at: "2026-05-13T10:00:00.000Z",
          finished_at: "2026-05-13T10:01:00.000Z",
        }),
      ],
    );
    expect(t?.toISOString()).toBe("2026-05-13T12:00:00.000Z");
  });

  it("does NOT consider task.next_run (scheduled-future is not a signal)", () => {
    // Guard: scheduling drift would creep back if a future contributor
    // pulled `next_run` into the signal set.
    const futureRun = "2099-01-01T00:00:00.000Z";
    const t = computeUpdatedAtFromSignals(
      baseTask({ next_run: futureRun }),
      [],
    );
    expect(t).toBeNull();
  });
});

describe("canonical conversation id", () => {
  it("uses task.chat_conversation_id when present", () => {
    expect(
      canonicalConversationId(
        baseTask({
          chat_conversation_id: "00000000-0000-0000-0000-000000000123",
        }),
      ),
    ).toBe("00000000-0000-0000-0000-000000000123");
  });

  it("falls back to uuid5(task:ID, AUTONOMOUS_NS) matching Python", () => {
    // Cross-language equality: this fixture was produced by
    //   python -c "import uuid; print(uuid.uuid5(uuid.UUID('4b2c0d6e-5b71-4f4a-9b4d-7c1e9f0a2b8e'),'task:t1'))"
    // If this assertion fails, either the JS namespace literal in
    // synthesize-conversation.ts or the Python `_AUTONOMOUS_NS` in
    // services/chat_history.py has drifted — re-introducing duplicate
    // sidebar rows. Fix the side that drifted, do NOT update the fixture.
    const conv = synthesizeConversationForTask(
      baseTask({ id: "t1", chat_conversation_id: undefined }),
      [],
    );
    expect(conv.id).toBe("a25e9fc5-8be0-528f-98d8-e2fd6f73dcc8");
  });

  it("synthesizeConversationForTask uses canonicalConversationId", () => {
    // Two equivalent paths to the same id (helper + synth) must agree.
    const t = baseTask({ id: "task-xyz", chat_conversation_id: undefined });
    const conv = synthesizeConversationForTask(t, []);
    expect(conv.id).toBe(canonicalConversationId(t));
  });
});

describe("synthesizeConversationForTask updatedAt stability", () => {
  it("returns identical updatedAt across two resyncs with no signal change", () => {
    const t = baseTask();
    const r = [baseRun()];
    const c1 = synthesizeConversationForTask(t, r);
    const c2 = synthesizeConversationForTask(t, r);
    expect(c2.updatedAt.getTime()).toBe(c1.updatedAt.getTime());
  });

  it("advances updatedAt when a new run finishes later", () => {
    const t = baseTask();
    const c1 = synthesizeConversationForTask(t, [baseRun()]);
    const c2 = synthesizeConversationForTask(t, [
      baseRun(),
      baseRun({
        run_id: "run-2",
        started_at: "2026-05-13T15:00:00.000Z",
        finished_at: "2026-05-13T15:01:00.000Z",
      }),
    ]);
    expect(c2.updatedAt.getTime()).toBeGreaterThan(c1.updatedAt.getTime());
  });

  it("returns NEVER when no signals (chat-store will lift to floor)", () => {
    const conv = synthesizeConversationForTask(baseTask(), []);
    expect(conv.updatedAt.getTime()).toBe(NEVER.getTime());
  });

  it("filter-switch resync (same task, same runs) does not bump updatedAt", () => {
    // User-visible symptom: clicking All/Autonomous would re-call synth
    // and reorder the sidebar even with no task change.
    const t = baseTask();
    const r = [baseRun()];
    const samples = Array.from({ length: 5 }, () =>
      synthesizeConversationForTask(t, r).updatedAt.getTime(),
    );
    expect(new Set(samples).size).toBe(1);
  });
});

describe("synthetic markers never stamp Date.now()", () => {
  it("preflightAck is omitted when ack_at is missing (no Date.now() fallback)", () => {
    const conv = synthesizeConversationForTask(
      baseTask({
        last_ack: {
          ack_status: "ok",
          ack_at: null,
        } as AutonomousTask["last_ack"],
      }),
      [],
    );
    expect(conv.messages.find((m) => m.id === "task:t1:preflight_ack")).toBeUndefined();
  });

  it("preflightAck stamps the real ack_at when present (no Date.now())", () => {
    const conv = synthesizeConversationForTask(
      baseTask({
        last_ack: {
          ack_status: "ok",
          ack_at: "2026-05-13T08:00:00.000Z",
        } as AutonomousTask["last_ack"],
      }),
      [],
    );
    const ack = conv.messages.find((m) => m.id === "task:t1:preflight_ack");
    expect(ack?.timestamp.toISOString()).toBe("2026-05-13T08:00:00.000Z");
  });

  it("creationIntent uses last_ack.ack_at when present, NEVER when absent", () => {
    const withAck = synthesizeConversationForTask(
      baseTask({
        last_ack: {
          ack_status: "ok",
          ack_at: "2026-05-13T08:00:00.000Z",
        } as AutonomousTask["last_ack"],
      }),
      [],
    );
    expect(
      withAck.messages
        .find((m) => m.id === "task:t1:creation_intent")
        ?.timestamp.toISOString(),
    ).toBe("2026-05-13T08:00:00.000Z");

    const withoutAck = synthesizeConversationForTask(baseTask(), []);
    expect(
      withoutAck.messages
        .find((m) => m.id === "task:t1:creation_intent")
        ?.timestamp.getTime(),
    ).toBe(NEVER.getTime());
  });

  it("next_run_marker.timestamp = task.next_run for cron tasks with next_run", () => {
    const conv = synthesizeConversationForTask(
      baseTask({ next_run: "2026-05-14T09:00:00.000Z" }),
      [],
    );
    const marker = conv.messages.find((m) => m.id === "task:t1:next_run_marker");
    expect(marker?.timestamp.toISOString()).toBe("2026-05-14T09:00:00.000Z");
  });

  it("next_run_marker is emitted for disabled tasks with timestamp=NEVER (UX hint preserved)", () => {
    const conv = synthesizeConversationForTask(
      baseTask({ enabled: false }),
      [],
    );
    const marker = conv.messages.find((m) => m.id === "task:t1:next_run_marker");
    expect(marker).toBeDefined();
    expect(marker?.content).toContain("disabled");
    expect(marker?.timestamp.getTime()).toBe(NEVER.getTime());
  });

  it("next_run_marker is emitted for webhook tasks with timestamp=NEVER (UX hint preserved)", () => {
    const conv = synthesizeConversationForTask(
      baseTask({ trigger: { type: "webhook" } }),
      [],
    );
    const marker = conv.messages.find((m) => m.id === "task:t1:next_run_marker");
    expect(marker).toBeDefined();
    expect(marker?.content).toContain("webhook");
    expect(marker?.timestamp.getTime()).toBe(NEVER.getTime());
  });

  it("next_run_marker returns null only for cron/interval tasks with no next_run (transient)", () => {
    const conv = synthesizeConversationForTask(
      baseTask({ next_run: null as unknown as string }),
      [],
    );
    expect(conv.messages.find((m) => m.id === "task:t1:next_run_marker")).toBeUndefined();
  });

  it("disabled/webhook markers do NOT contribute to conv.updatedAt", () => {
    // The marker timestamp is NEVER (epoch 0). If it leaked into the
    // updatedAt computation, conv.updatedAt would be epoch 0; instead
    // we expect the synth to use computeUpdatedAtFromSignals (which
    // returns null with no runs/ack), yielding updatedAt === NEVER
    // strictly because there are no signals, NOT because of the marker.
    const webhook = synthesizeConversationForTask(
      baseTask({ trigger: { type: "webhook" } }),
      [
        baseRun({
          started_at: "2026-05-13T10:00:00.000Z",
          finished_at: "2026-05-13T10:01:00.000Z",
        }),
      ],
    );
    // With one run, updatedAt should reflect the run, not NEVER and
    // not the webhook marker's NEVER.
    expect(webhook.updatedAt.toISOString()).toBe("2026-05-13T10:01:00.000Z");
  });
});
