#!/usr/bin/env python3
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Slack Streaming Simulator

Runs the exact same event-processing logic as the Slack bot (StreamBuffer,
parse_event, streaming_final_answer, plan flow, etc.) but renders output
to the terminal instead of posting to Slack.

Shows precisely:
  - What appendStream / startStream / stopStream receive
  - Whether the final answer arrives as streamed chunks or in stopStream
  - Whether duplicates occur

Usage:
  PYTHONPATH=. python tests/simulate_slack_stream.py "what is agntcy"
  PYTHONPATH=. python tests/simulate_slack_stream.py "how do I setup caipe"
"""

import sys
import time
import uuid

# ── Re-use the real A2A client and event parser ───────────────────────────────
from ai_platform_engineering.integrations.slack_bot.a2a_client import A2AClient
from ai_platform_engineering.integrations.slack_bot.utils.event_parser import (
    EventType,
    parse_event,
)

# ── StreamBuffer — identical copy from ai.py (avoids Slack config import) ────
class StreamBuffer:
    """Batches markdown text chunks before flushing to Slack's appendStream.

    Identical to ai_platform_engineering/integrations/slack_bot/utils/ai.py::StreamBuffer.
    Copied here to avoid the Slack config import chain in tests.
    """

    def __init__(self, slack_client, channel_id, stream_ts, flush_interval=1.0):
        self.slack_client  = slack_client
        self.channel_id    = channel_id
        self.stream_ts     = stream_ts
        self.flush_interval = flush_interval
        self._buffer       = ""
        self._last_flush   = time.monotonic()
        self._flushed_any  = False

    @property
    def has_flushed(self):
        return self._flushed_any

    def append(self, text):
        self._buffer += text
        elapsed = time.monotonic() - self._last_flush
        if "\n" in self._buffer:
            last_nl = self._buffer.rfind("\n")
            to_flush = self._buffer[: last_nl + 1]
            self._buffer = self._buffer[last_nl + 1 :]
            if to_flush:
                self._send(to_flush)
        elif elapsed >= self.flush_interval:
            self.flush()

    def flush(self):
        if not self._buffer:
            return False
        text = self._buffer
        self._buffer = ""
        return self._send(text)

    def _send(self, text):
        self._last_flush = time.monotonic()
        try:
            self.slack_client.chat_appendStream(
                channel=self.channel_id,
                ts=self.stream_ts,
                chunks=[{"type": "markdown_text", "text": text}],
            )
            self._flushed_any = True
            return True
        except Exception as e:
            print(f"WARN appendStream failed: {e}")
            return False

BASE_URL = "http://localhost:8000"

# ── ANSI helpers ──────────────────────────────────────────────────────────────
RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
CYAN   = "\033[36m"
GREEN  = "\033[32m"
YELLOW = "\033[33m"
RED    = "\033[31m"
BLUE   = "\033[34m"
GREY   = "\033[90m"

def hdr(label, color=CYAN):
    width = 72
    bar = "─" * width
    print(f"\n{color}{bar}{RESET}")
    print(f"{color}{BOLD}  {label}{RESET}")
    print(f"{color}{bar}{RESET}")

def tag(label, color=GREY):
    return f"{color}[{label}]{RESET}"


# ── Fake Slack client — records and renders what Slack would receive ──────────
class FakeSlackClient:
    def __init__(self):
        self._stream_ts = None
        self._stream_chunks: list[str] = []   # text accumulated via appendStream
        self._stop_chunks: list[str] = []     # text sent in stopStream
        self._append_calls = 0
        self._block_calls  = 0

    # ---- startStream --------------------------------------------------------
    def chat_startStream(self, *, channel, thread_ts, **kwargs):
        self._stream_ts = f"fake-{uuid.uuid4().hex[:8]}"
        hdr("startStream", BLUE)
        print(f"  {tag('SLACK')} Stream opened  ts={self._stream_ts}")
        return {"ts": self._stream_ts, "ok": True}

    # ---- appendStream -------------------------------------------------------
    def chat_appendStream(self, *, channel, ts, chunks, **kwargs):
        if not chunks:
            return {"ok": True}
        for chunk in chunks:
            ctype = chunk.get("type", "?")
            if ctype == "markdown_text":
                text = chunk.get("text", "")
                self._stream_chunks.append(text)
                self._append_calls += 1
                # Print each token flush exactly as Slack receives it
                print(f"{CYAN}{DIM}┊ appendStream (text, {len(text)}c){RESET} {repr(text[:80])}")
            else:
                self._block_calls += 1
                block_id = chunk.get("id", chunk.get("type", "block"))
                status   = chunk.get("status", "")
                label    = f"{block_id}:{status}" if status else block_id
                print(f"{YELLOW}┊ appendStream (block){RESET} {label}")
        return {"ok": True}

    # ---- stopStream ---------------------------------------------------------
    def chat_stopStream(self, *, channel, ts, chunks=None, blocks=None, **kwargs):
        hdr("stopStream", GREEN)
        if chunks:
            for c in chunks:
                text = c.get("text", "")
                self._stop_chunks.append(text)
                print(f"  {tag('STOP TEXT', GREEN)} ({len(text)}c)")
                print(f"{GREEN}{text}{RESET}")
        else:
            print(f"  {tag('STOP TEXT', GREY)} (none — already streamed)")
        if blocks:
            print(f"  {tag('STOP BLOCKS', YELLOW)} {len(blocks)} blocks (feedback/footer)")
        return {"ok": True}

    # ---- render summary ─────────────────────────────────────────────────────
    def render_summary(self):
        hdr("What Slack Rendered", BOLD)
        streamed = "".join(self._stream_chunks)
        stopped  = "".join(self._stop_chunks)
        if streamed:
            print(f"{CYAN}{BOLD}[Streamed live via appendStream ({self._append_calls} calls)]{RESET}")
            print(streamed[:2000])
        if stopped:
            print(f"\n{GREEN}{BOLD}[Final answer via stopStream]{RESET}")
            print(stopped[:2000])
        if not streamed and not stopped:
            print(f"{RED}⚠  NOTHING was rendered to the user!{RESET}")
        if streamed and stopped:
            # Check for actual content overlap (not just both being non-empty).
            # Sub-agent narration in appendStream + final answer in stopStream = correct.
            if stopped[:100].strip() in streamed or streamed[-100:].strip() in stopped:
                print(f"\n{RED}{BOLD}⚠  DUPLICATE: same content in both streams!{RESET}")
            else:
                print(f"\n{YELLOW}ℹ  Both streams non-empty (narration + answer — expected){RESET}")
        print(f"\n{DIM}appendStream text calls: {self._append_calls}  "
              f"block calls: {self._block_calls}{RESET}")


# ── A2A SSE client — uses the real A2AClient ─────────────────────────────────
def sse_stream(question: str):
    client = A2AClient(BASE_URL, timeout=180)
    yield from client.send_message_stream(question)


# ── Core simulation — mirrors stream_a2a_response exactly ────────────────────
def simulate(question: str):
    slack = FakeSlackClient()
    channel_id = "C_FAKE"
    thread_ts  = "fake-thread"

    # State mirrors ai.py
    stream_ts             = None
    stream_buf: StreamBuffer | None = None
    plan_steps: dict      = {}
    sent_step_status: dict = {}   # noqa: F841  (used in Slack bot; simplified away in sim)
    any_subagent_completed = False
    streaming_final_answer = False
    needs_separator        = False
    current_step_id        = None
    final_result_text      = None
    partial_result_text    = None

    event_counts: dict[str, int] = {}

    def _start_stream_if_needed():
        nonlocal stream_ts, stream_buf
        if stream_ts:
            return
        resp = slack.chat_startStream(channel=channel_id, thread_ts=thread_ts)
        stream_ts = resp["ts"]
        stream_buf = StreamBuffer(slack, channel_id, stream_ts)

    hdr(f"Simulating Slack bot — query: {question!r}", BOLD)

    for result in sse_stream(question):
        parsed = parse_event(result)
        kind = parsed.event_type
        event_counts[kind.value] = event_counts.get(kind.value, 0) + 1

        # ── STREAMING_RESULT ──────────────────────────────────────────────
        if kind == EventType.STREAMING_RESULT:
            text = parsed.text_content or ""
            meta = (parsed.artifact or {}).get("metadata", {})
            step_id = meta.get("plan_step_id")
            if step_id:
                current_step_id = step_id

            if any_subagent_completed:
                if not stream_ts:
                    print(f"{GREY}  [suppress pre-stream post-subagent chunk ({len(text)}c)]{RESET}")
                    continue
                streaming_final_answer = True

            if text:
                sorted_steps = sorted(plan_steps.values(), key=lambda s: s.get("order", 0))
                if sorted_steps and current_step_id and not streaming_final_answer:
                    last_step = sorted_steps[-1]
                    if (last_step.get("step_id") == current_step_id
                            and last_step.get("status") == "completed"):
                        streaming_final_answer = True

                if text:
                    _start_stream_if_needed()
                    if stream_buf:
                        if needs_separator and stream_buf.has_flushed:
                            text = "\n\n" + text
                            needs_separator = False
                        stream_buf.append(text)

        # ── FINAL_RESULT ─────────────────────────────────────────────────
        elif kind == EventType.FINAL_RESULT:
            if parsed.text_content:
                final_result_text = parsed.text_content
                print(f"\n{GREEN}  [FINAL_RESULT received: {len(parsed.text_content)}c, "
                      f"streaming_final_answer={streaming_final_answer}]{RESET}")
                if streaming_final_answer:
                    print(f"{GREY}  → Skipping re-stream (already streamed via STREAMING_RESULT){RESET}")
                elif plan_steps:
                    print(f"{YELLOW}  → Plan flow: deferring to stopStream.chunks{RESET}")
                else:
                    _start_stream_if_needed()
                    if stream_buf:
                        if needs_separator and stream_buf.has_flushed:
                            stream_buf.append("\n\n")
                            needs_separator = False
                        stream_buf.append(parsed.text_content)
                        stream_buf.flush()
                        streaming_final_answer = True

        # ── PARTIAL_RESULT ────────────────────────────────────────────────
        elif kind == EventType.PARTIAL_RESULT:
            if parsed.text_content:
                partial_result_text = parsed.text_content

        # ── TOOL_NOTIFICATION_START ───────────────────────────────────────
        elif kind == EventType.TOOL_NOTIFICATION_START:
            if stream_buf:
                stream_buf.flush()
            name = (parsed.tool_notification.tool_name if parsed.tool_notification else "?")
            print(f"{YELLOW}  {tag('TOOL START')} {name}{RESET}")
            needs_separator = True

        # ── TOOL_NOTIFICATION_END ─────────────────────────────────────────
        elif kind == EventType.TOOL_NOTIFICATION_END:
            name = (parsed.tool_notification.tool_name if parsed.tool_notification else "?")
            print(f"{YELLOW}  {tag('TOOL END')} {name}{RESET}")
            # Plan flows: sub-agent completion is signalled by plan step → completed.
            # No-plan flows: fall back to tool completion as proxy.
            if not plan_steps:
                _RAG_TOOL_NAMES = {"search", "fetch_document", "list_datasources", "fetch_url"}
                if name.lower() not in _RAG_TOOL_NAMES:
                    any_subagent_completed = True

        # ── EXECUTION_PLAN ────────────────────────────────────────────────
        elif kind == EventType.EXECUTION_PLAN:
            if parsed.plan_data:
                steps = parsed.plan_data.get("steps", [])
                for s in steps:
                    prev_status = plan_steps.get(s["step_id"], {}).get("status")
                    plan_steps[s["step_id"]] = s
                    if s.get("status") == "completed" and prev_status != "completed":
                        any_subagent_completed = True
                        print(f"{GREEN}  {tag('SUBAGENT DONE')} step {s['step_id'][:16]} completed{RESET}")
                changed = steps  # simplified
                chunk_ids = [f"{s['step_id'][:16]}:{s.get('status','?')}" for s in changed]
                print(f"{YELLOW}  {tag('PLAN UPDATE')} {chunk_ids}{RESET}")
                _start_stream_if_needed()
                if stream_ts:
                    fake_chunks = [{"type": "plan_block", "id": s["step_id"],
                                    "status": s.get("status", "?")} for s in changed]
                    slack.chat_appendStream(channel=channel_id, ts=stream_ts, chunks=fake_chunks)

        # ── STATUS_UPDATE (completed) ─────────────────────────────────────
        elif kind == EventType.STATUS_UPDATE:
            state = (parsed.status or {}).get("state", "")
            if state == "completed":
                print(f"{GREEN}  {tag('DONE')} task completed{RESET}")
                break

    # ── Finalization (mirrors lines 650-720 of ai.py) ─────────────────────
    hdr("Finalization", YELLOW)
    _start_stream_if_needed()
    if stream_buf:
        stream_buf.flush()

    streamed_any_text = stream_buf.has_flushed if stream_buf else False
    already_streamed  = streaming_final_answer or (
        not plan_steps and streamed_any_text and not final_result_text
    )
    needs_final = not already_streamed

    # Resolve final_text
    final_text = final_result_text or partial_result_text or ""
    print(f"  streaming_final_answer={streaming_final_answer}")
    print(f"  plan_steps={len(plan_steps)}, streamed_any_text={streamed_any_text}")
    print(f"  already_streamed={already_streamed}, needs_final={needs_final}")
    print(f"  final_text length={len(final_text)}")

    stop_chunks = []
    if needs_final and final_text:
        stop_chunks.append({"type": "markdown_text", "text": final_text})

    fake_stop_blocks = [{"type": "feedback", "text": "👍 👎 • Mention @CAIPE to continue"}]
    slack.chat_stopStream(
        channel=channel_id,
        ts=stream_ts or "never-started",
        chunks=stop_chunks if stop_chunks else None,
        blocks=fake_stop_blocks,
    )

    print(f"\n{DIM}Event counts: {event_counts}{RESET}")
    slack.render_summary()


if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "what is agntcy"
    simulate(q)
