// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

/**
 * Adapter: turns an autonomous-agents Task (+ its runs) into a chat-store
 * Conversation so the existing chat sidebar / chat container can render
 * it natively without any of the chat plumbing knowing it came from a
 * different source.
 *
 * Spec #099 Story 2 / FR-006..009: each task is one chat thread; messages
 * accumulate over time as runs fire. With Mongo, the autonomous-agents
 * service writes those messages directly to the UI's `messages`
 * collection (see chat_history.MongoChatHistoryPublisher). On a
 * native-dev PC without Mongo this adapter does the same job at read
 * time, so the operator sees the same UX with zero infrastructure.
 *
 * The synthesised messages mirror the metadata.kind enumeration used
 * by the Mongo publisher (creation_intent, preflight_ack,
 * next_run_marker, run_request, run_response, run_error) so a future
 * UI affordance for those kinds can drop in without forking this
 * adapter.
 */

import type { A2AEvent, ChatMessage, Conversation } from "@/types/a2a";
import { buildParticipants } from "@/types/a2a";
import { buildTimelineSegmentsFromEvents } from "@/lib/replay-timeline";

import type { AutonomousTask, TaskRun } from "./types";

const TURN_PREFIX = "autonomous-task";

function isoToDate(value?: string | null, fallback?: Date): Date {
  if (!value) return fallback ?? new Date();
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return fallback ?? new Date();
    return d;
  } catch {
    return fallback ?? new Date();
  }
}

function describeTrigger(task: AutonomousTask): string {
  const t = task.trigger;
  if (t.type === "cron") return `cron · ${t.schedule}`;
  if (t.type === "interval") {
    const parts: string[] = [];
    if (t.hours) parts.push(`${t.hours}h`);
    if (t.minutes) parts.push(`${t.minutes}m`);
    if (t.seconds) parts.push(`${t.seconds}s`);
    return `every ${parts.join(" ") || "—"}`;
  }
  return "webhook (POST /api/v1/hooks/" + task.id + ")";
}

/**
 * Build the creation_intent message — the very first row in the thread,
 * synthesised from the form values the operator submitted.
 */
function creationIntent(task: AutonomousTask): ChatMessage {
  const lines: string[] = [
    `Created task **${task.name}** (id: \`${task.id}\`).`,
    "",
    `**Target sub-agent**: ${task.agent ?? "_(LLM router will choose)_"}`,
    `**Trigger**: ${describeTrigger(task)}`,
  ];
  if (task.llm_provider) {
    lines.push(`**LLM provider**: ${task.llm_provider}`);
  }
  lines.push("", "**Prompt:**", task.prompt);

  return {
    id: `task:${task.id}:creation_intent`,
    role: "user",
    content: lines.join("\n"),
    timestamp: isoToDate(task.last_ack?.ack_at, new Date(0)),
    events: [],
    isFinal: true,
    turnId: `${TURN_PREFIX}-${task.id}-creation`,
  };
}

/**
 * Build the preflight_ack message from `task.last_ack`. Returns null if
 * preflight has not yet been attempted (the badge in the sidebar shows
 * "Ack pending" in that case; a synthetic message would be redundant).
 */
function preflightAck(task: AutonomousTask): ChatMessage | null {
  const ack = task.last_ack;
  if (!ack) return null;

  const statusEmoji = {
    ok: "✓",
    warn: "⚠",
    failed: "✗",
    pending: "…",
  }[ack.ack_status] ?? "?";

  const lines: string[] = [
    `${statusEmoji} **Pre-flight: ${ack.ack_status.toUpperCase()}**`,
  ];
  if (ack.ack_detail) lines.push(ack.ack_detail);
  if (ack.routed_to) lines.push("", `**Routed to**: \`${ack.routed_to}\``);
  if (ack.tools && ack.tools.length > 0) {
    lines.push(`**Tools loaded**: ${ack.tools.length}`);
  }
  if (ack.dry_run_summary) {
    lines.push("", ack.dry_run_summary);
  }

  return {
    id: `task:${task.id}:preflight_ack`,
    role: "assistant",
    content: lines.join("\n"),
    timestamp: isoToDate(ack.ack_at, new Date()),
    events: [],
    isFinal: true,
    turnId: `${TURN_PREFIX}-${task.id}-creation`,
  };
}

/**
 * Build the next_run_marker — informational message at the *end* of the
 * thread that tells the operator when the next scheduled fire is.
 * Returns null for disabled / webhook tasks (no scheduled run).
 */
function nextRunMarker(task: AutonomousTask): ChatMessage | null {
  if (!task.enabled) {
    return {
      id: `task:${task.id}:next_run_marker`,
      role: "system" as unknown as "assistant",
      content: "_Task is disabled. Enable it to resume the schedule._",
      timestamp: new Date(),
      events: [],
      isFinal: true,
      turnId: `${TURN_PREFIX}-${task.id}-marker`,
    };
  }
  if (task.trigger.type === "webhook") {
    return {
      id: `task:${task.id}:next_run_marker`,
      role: "system" as unknown as "assistant",
      content: `_Triggered by external webhook → \`POST /api/v1/hooks/${task.id}\`._`,
      timestamp: new Date(),
      events: [],
      isFinal: true,
      turnId: `${TURN_PREFIX}-${task.id}-marker`,
    };
  }
  if (!task.next_run) return null;
  const nextDate = isoToDate(task.next_run);
  return {
    id: `task:${task.id}:next_run_marker`,
    role: "system" as unknown as "assistant",
    content: `_Next scheduled run: **${nextDate.toLocaleString()}** (${task.next_run})_`,
    timestamp: new Date(),
    events: [],
    isFinal: true,
    turnId: `${TURN_PREFIX}-${task.id}-marker`,
  };
}

/**
 * Convert raw A2A event dicts (as captured by ``invoke_agent_streaming``
 * server-side) into the UI's ``A2AEvent`` shape. The captured events are
 * already plain JSON dicts that mirror the supervisor's wire format —
 * we just need to give each one a stable id and the type tag the chat
 * renderer expects.
 *
 * Spec #099 Phase B / Story 2 — replaying these events through the
 * existing message renderer is what makes scheduled-run threads render
 * the plan + tools + timeline instead of a one-line preview tombstone.
 */
function eventsForRun(run: TaskRun): A2AEvent[] {
  const raw = run.events ?? [];
  const out: A2AEvent[] = [];
  raw.forEach((event, idx) => {
    if (!event || typeof event !== "object") return;
    // ``kind`` is the discriminator from the supervisor's A2A SDK
    // (task | artifact-update | status-update | message). The chat
    // renderer's reducers branch on it, so we surface it both as
    // ``type`` (legacy shape) and pass through the rest of the payload
    // verbatim. Payload keys (``artifact``, ``status``, ``parts`` ...)
    // are already in the shape the renderer expects.
    const kind = (event as { kind?: string }).kind;
    out.push({
      id: `run:${run.run_id}:evt:${idx}`,
      type: typeof kind === "string" ? kind : "unknown",
      ...(event as Record<string, unknown>),
    } as A2AEvent);
  });
  return out;
}

function requestContentForRun(task: AutonomousTask, run: TaskRun): string {
  const prompt = run.request_prompt || task.prompt;
  if (!run.parent_run_id || !run.request_prompt) return prompt;

  const match = run.request_prompt.match(
    /\n\nOperator follow-up \(([^,\n)]+)[^\n)]*\):\n([\s\S]*)$/,
  );
  if (!match) return prompt;

  const transport = match[1] || "follow-up";
  const message = (match[2] || "").trim();
  if (!message) return prompt;

  const label =
    transport.length > 0
      ? `${transport.charAt(0).toUpperCase()}${transport.slice(1)}`
      : "Follow-up";
  return `${label} Follow-up: ${message}`;
}

/**
 * Build the (run_request, run_response|run_error) pair for a single run.
 * Earliest run first.
 *
 * Spec #099 Phase B: the assistant message carries the FULL supervisor
 * response (``response_full`` when present, falling back to
 * ``response_preview`` for legacy runs) and the captured streaming
 * events so the chat renderer can show the plan + tools + timeline
 * just like it does for typed messages.
 */
function messagesForRun(task: AutonomousTask, run: TaskRun): ChatMessage[] {
  const out: ChatMessage[] = [];
  out.push({
    id: `run:${run.run_id}:request`,
    role: "user",
    content: requestContentForRun(task, run),
    timestamp: isoToDate(run.started_at),
    events: [],
    isFinal: true,
    turnId: `${TURN_PREFIX}-${task.id}-run-${run.run_id}`,
  });

  const events = eventsForRun(run);
  // Spec #099 Phase B follow-up — replay the captured A2A events
  // through the same TimelineManager logic the streaming chat path
  // uses, so scheduled-run assistant messages render with the SAME
  // collapsible Plan + Tools + Thinking + FinalAnswer affordances a
  // typed message gets. Without this the message body was a flat
  // markdown bubble even though the events were populated correctly.
  const timelineSegments = buildTimelineSegmentsFromEvents(
    (run.events ?? []) as ReadonlyArray<Record<string, unknown>>,
  );

  let body: string;
  if (run.status === "failed") {
    body = `**Run failed** (${run.run_id}):\n\n${run.error || "_unknown error_"}`;
  } else if (run.status === "success") {
    body = run.response_full || run.response_preview || "_(empty response)_";
  } else if (run.status === "running") {
    body = "_Run in progress…_";
  } else {
    body = `_Status: ${run.status}_`;
  }
  out.push({
    id: `run:${run.run_id}:response`,
    role: "assistant",
    content: body,
    timestamp: isoToDate(run.finished_at || run.started_at),
    events,
    timelineSegments,
    isFinal: run.status !== "running" && run.status !== "pending",
    turnId: `${TURN_PREFIX}-${task.id}-run-${run.run_id}`,
  });
  return out;
}

/**
 * Compose the full message list for a task. Order:
 *   1. creation_intent
 *   2. preflight_ack (if any)
 *   3. for each run (oldest first): run_request + run_response/error
 *   4. next_run_marker (informational; appears at the bottom)
 */
export function synthesizeMessagesForTask(
  task: AutonomousTask,
  runs: TaskRun[],
): ChatMessage[] {
  const messages: ChatMessage[] = [creationIntent(task)];
  const ack = preflightAck(task);
  if (ack) messages.push(ack);

  // Sort runs oldest -> newest for chronological reading.
  const sorted = [...runs].sort((a, b) => {
    const ta = new Date(a.started_at).getTime();
    const tb = new Date(b.started_at).getTime();
    return ta - tb;
  });
  for (const run of sorted) {
    messages.push(...messagesForRun(task, run));
  }

  const marker = nextRunMarker(task);
  if (marker) messages.push(marker);
  return messages;
}

/**
 * Build a fully-populated chat-store Conversation for an autonomous task.
 * Conversation id is the task's chat_conversation_id (deterministic
 * UUIDv5) so a re-fetch of the same task always lands on the same
 * Conversation row in the store and the right pane stays selected.
 */
export function synthesizeConversationForTask(
  task: AutonomousTask,
  runs: TaskRun[],
): Conversation {
  const conversationId = task.chat_conversation_id ?? `autonomous-${task.id}`;
  const messages = synthesizeMessagesForTask(task, runs);
  const lastMessage = messages[messages.length - 1];
  const updatedAt = lastMessage?.timestamp ?? new Date();

  // Spec #099 Phase B — aggregate all per-run A2A events onto the
  // conversation's ``a2aEvents`` list so the right-side A2A debug panel
  // populates for past scheduled runs the same way it does for an
  // in-progress typed reply. Order matches chronological run order
  // (oldest first), then per-run event order, so scrolling the panel
  // walks the workflow forward in time.
  const sortedRuns = [...runs].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
  );
  const allEvents: A2AEvent[] = sortedRuns.flatMap((r) => eventsForRun(r));

  return {
    id: conversationId,
    title: `${task.name}`,
    createdAt: messages[0]?.timestamp ?? new Date(),
    updatedAt,
    messages,
    a2aEvents: allEvents,
    streamEvents: [],
    // Prefer ``dynamic_agent_id`` -- for custom-agent tasks ``agent``
    // is now ``null`` (see syncAutonomousTasks) and the routing target
    // lives on ``dynamic_agent_id``. Without this fallback the
    // synthesised conversation has no agent participant, the sidebar
    // loses its agent-name suffix, and ChatContainer's ``getAgentId``
    // falls back to the Platform Engineer instead of the custom agent.
    participants: buildParticipants(task.dynamic_agent_id ?? task.agent),
    source: "autonomous",
    task_id: task.id,
  };
}
