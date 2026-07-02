"""Shared SDK run loop for the tome agent's streaming agents.

Every streaming agent — source ingest (`ingestor.py`), BHAG synthesis
(`synthesize.py`), and future cross-project subagents (#66 integrity / graph
resolver, #42 compression) — builds its own `ClaudeAgentOptions` + opening
prompt, then delegates the message→event streaming here. Centralizing it keeps
the event vocabulary (tool_call / tool_result / page_written / done / error /
log) identical across agents and out of each agent's body.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from claude_agent_sdk import (
    TERMINAL_TASK_STATUSES,
    AssistantMessage,
    ResultMessage,
    SystemMessage,
    TaskNotificationMessage,
    TaskProgressMessage,
    TaskStartedMessage,
    TaskUpdatedMessage,
    TextBlock,
    ToolUseBlock,
    UserMessage,
    query,
)

from tome_agent.orchestrator.contract import IngestEventPayload

log = logging.getLogger("tome_agent.agent.run_stream")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def emit_log(line: str) -> IngestEventPayload:
    return IngestEventPayload(type="log", data={"line": line, "ts": now_iso()})


def stringify_tool_input(value: object) -> str:
    try:
        return json.dumps(value, separators=(", ", "="))[:300]
    except Exception:
        return str(value)[:300]


# Anthropic usage-block keys → the short keys we surface to the ingest pane.
_USAGE_FIELDS = {
    "input": "input_tokens",
    "output": "output_tokens",
    "cache_read": "cache_read_input_tokens",
    "cache_write": "cache_creation_input_tokens",
}


def extract_usage(usage: dict | None) -> dict[str, int]:
    """Pull the token counts we display from an SDK message's `usage` block.
    Only positive integers survive, so an empty/partial block yields {}."""
    if not usage:
        return {}
    out: dict[str, int] = {}
    for short, key in _USAGE_FIELDS.items():
        v = usage.get(key)
        if isinstance(v, int) and v > 0:
            out[short] = v
    return out


async def consume_agent_query(
    prompt: str,
    options,
    log_buf: list[IngestEventPayload],
) -> AsyncIterator[IngestEventPayload]:
    """Run the SDK query and translate each message into IngestEventPayloads,
    draining `log_buf` (the persist hook's `page_written` events) as it goes.

    `log_buf` is the same list the caller's `on_write` hook appends to; passing
    it in lets page-write events interleave with tool/text events in order."""
    result_seen = False
    tool_call_count = 0
    tool_call_names: dict[str, str] = {}
    # Running token totals across every model turn (top-level and subagent). Each
    # AssistantMessage.usage is that one request's usage, so summing gives the
    # session total. Surfaced live so the pane shows spend as the agent works.
    usage_acc: dict[str, int] = {}
    # Per-subagent state so nested work surfaces in the log instead of a silent
    # multi-minute gap (#69). `subagent_desc` labels the terminal line; the SDK
    # emits a terminal status via either a TaskNotification or a TaskUpdated, so
    # whichever fires first clears the entry and the other becomes a no-op.
    subagent_desc: dict[str, str] = {}
    subagent_last_tool: dict[str, str] = {}
    try:
        async for message in query(prompt=prompt, options=options):
            # Drain any persist-hook events accumulated since the last yield.
            while log_buf:
                yield log_buf.pop(0)

            if isinstance(message, AssistantMessage):
                # Messages from a subagent carry the parent Task's tool_use id;
                # render them indented so they read as nested subagent activity.
                nested = getattr(message, "parent_tool_use_id", None) is not None
                for block in message.content:
                    if isinstance(block, ToolUseBlock):
                        short = block.name.replace("mcp__github__", "gh.")
                        if nested:
                            yield emit_log(
                                f"    ↳ {short} {stringify_tool_input(block.input)}"
                            )
                            continue
                        tool_call_count += 1
                        tool_call_names[block.id] = short
                        yield IngestEventPayload(
                            type="tool_call",
                            data={
                                "id": block.id,
                                "tool": short,
                                "input": stringify_tool_input(block.input),
                                "ts": now_iso(),
                            },
                        )
                    elif isinstance(block, TextBlock):
                        text = (block.text or "").strip()
                        if text:
                            prefix = "    ↳ ~" if nested else "~"
                            for line in text.splitlines():
                                if line.strip():
                                    yield emit_log(f"{prefix} {line}")
                # Fold this turn's usage into the running total. Emit a live
                # snapshot only on top-level turns — subagent turns are already
                # summed in, and the next top-level turn's snapshot reflects them.
                turn_usage = extract_usage(getattr(message, "usage", None))
                for k, v in turn_usage.items():
                    usage_acc[k] = usage_acc.get(k, 0) + v
                if turn_usage and not nested:
                    yield IngestEventPayload(
                        type="usage",
                        data={**usage_acc, "ts": now_iso()},
                    )
            elif isinstance(message, UserMessage):
                # Skip a subagent's internal tool results — the task_progress
                # heartbeat already conveys the subagent is alive and working.
                if getattr(message, "parent_tool_use_id", None) is not None:
                    continue
                for block in getattr(message, "content", []) or []:
                    kind = getattr(block, "type", None) or (
                        block.get("type") if isinstance(block, dict) else None
                    )
                    if kind == "tool_result":
                        tool_id = getattr(block, "tool_use_id", None) or (
                            block.get("tool_use_id") if isinstance(block, dict) else None
                        )
                        is_error = getattr(block, "is_error", False) or (
                            block.get("is_error", False) if isinstance(block, dict) else False
                        )
                        label = tool_call_names.get(tool_id or "", "?")
                        if is_error:
                            log.debug("tool result error: tool=%s id=%s", label, tool_id)
                        yield IngestEventPayload(
                            type="tool_result",
                            data={
                                "id": tool_id,
                                "label": label,
                                "is_error": is_error,
                                "ts": now_iso(),
                            },
                        )
            elif isinstance(message, TaskStartedMessage):
                desc = (message.description or "subagent").strip()
                subagent_desc[message.task_id] = desc
                kind = f" [{message.task_type}]" if message.task_type else ""
                yield emit_log(f"  ↳ subagent started{kind}: {desc[:160]}")
            elif isinstance(message, TaskProgressMessage):
                # Heartbeat: emit only when the subagent's active tool changes, so
                # a long subagent shows steady progress without flooding the log.
                tool = (message.last_tool_name or "").strip()
                if tool and subagent_last_tool.get(message.task_id) != tool:
                    subagent_last_tool[message.task_id] = tool
                    yield emit_log(f"    ↳ {tool.replace('mcp__github__', 'gh.')}")
            elif isinstance(message, TaskNotificationMessage):
                subagent_desc.pop(message.task_id, None)
                subagent_last_tool.pop(message.task_id, None)
                raw = (message.summary or "").strip()
                summary = raw.splitlines()[0] if raw else ""
                tail = f": {summary[:160]}" if summary else ""
                yield emit_log(f"  ↳ subagent {message.status}{tail}")
            elif isinstance(message, TaskUpdatedMessage):
                # Terminal state can arrive only as a TaskUpdated (e.g. killed).
                # Emit a closing line only if a TaskNotification hasn't already.
                if (
                    message.status in TERMINAL_TASK_STATUSES
                    and message.task_id in subagent_desc
                ):
                    subagent_desc.pop(message.task_id, None)
                    subagent_last_tool.pop(message.task_id, None)
                    yield emit_log(f"  ↳ subagent {message.status}")
            elif isinstance(message, SystemMessage):
                if message.subtype == "init":
                    yield emit_log("· agent session opened")
            elif isinstance(message, ResultMessage):
                result_seen = True
                if getattr(message, "is_error", False) and message.subtype != "success":
                    log.warning(
                        "ResultMessage has is_error=True: subtype=%s errors=%s",
                        message.subtype,
                        getattr(message, "errors", None),
                    )
                # Prefer the ResultMessage's authoritative session usage; fall
                # back to our per-turn accumulator if the CLI omits it.
                final_usage = extract_usage(getattr(message, "usage", None)) or usage_acc
                yield IngestEventPayload(
                    type="done",
                    data={
                        "subtype": message.subtype,
                        "turns": getattr(message, "num_turns", None),
                        "tool_calls": tool_call_count,
                        "cost_usd": getattr(message, "total_cost_usd", None),
                        "tokens": final_usage,
                        "ts": now_iso(),
                    },
                )

        # Drain any remaining events after the loop ends.
        while log_buf:
            yield log_buf.pop(0)

    except Exception as e:
        if result_seen:
            log.warning(
                "agent stream raised after ResultMessage (skill tool-deny artifact, ignoring)",
                exc_info=True,
            )
        else:
            log.exception("agent stream failed")
            yield IngestEventPayload(type="error", data={"message": f"{type(e).__name__}: {e}"})
