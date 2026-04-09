#!/usr/bin/env python3
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Slack Streaming Simulator & Conformance Test Suite

Runs the exact same event-processing logic as the Slack bot (StreamBuffer,
parse_event, streaming_final_answer, plan flow, etc.) but renders output
to the terminal instead of posting to Slack.

Shows precisely:
  - What appendStream / startStream / stopStream receive
  - Whether the final answer arrives as streamed chunks or in stopStream
  - Whether duplicates occur

Modes:
  Single query:
    PYTHONPATH=. python tests/simulate_slack_stream.py "what is agntcy"
    PYTHONPATH=. python tests/simulate_slack_stream.py "how do I setup claude code" -v

  Conformance suite (tests all scenarios):
    PYTHONPATH=. python tests/simulate_slack_stream.py --suite
    PYTHONPATH=. python tests/simulate_slack_stream.py --suite -v

  Conformance suite with report:
    PYTHONPATH=. python tests/simulate_slack_stream.py --suite --report
    PYTHONPATH=. python tests/simulate_slack_stream.py --suite --report my_report.md
"""

import argparse
import datetime
import os
import sys
import time
import uuid

# ── Re-use the real A2A client and event parser ───────────────────────────────
from ai_platform_engineering.integrations.slack_bot.a2a_client import A2AClient
from ai_platform_engineering.integrations.slack_bot.utils.event_parser import (
    EventType,
    parse_event,
)

# ── CLI args (parsed once at import time for use in helpers) ──────────────────
def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Simulate the CAIPE Slack bot streaming pipeline locally.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  PYTHONPATH=. python tests/simulate_slack_stream.py "what is agntcy"
  PYTHONPATH=. python tests/simulate_slack_stream.py "how do I setup caipe" -v
  PYTHONPATH=. python tests/simulate_slack_stream.py "what is agntcy" --answer-only
  PYTHONPATH=. python tests/simulate_slack_stream.py "ping" --url http://staging:8000 --timeout 60
        """,
    )
    p.add_argument(
        "query",
        nargs="?",
        default="what is agntcy",
        help="Question to send to the supervisor (default: 'what is agntcy')",
    )
    p.add_argument(
        "--url", "-u",
        default="http://localhost:8000",
        metavar="URL",
        help="Base URL of the A2A supervisor (default: http://localhost:8000)",
    )
    p.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show every tool start/end event and appendStream block call",
    )
    p.add_argument(
        "--answer-only", "-a",
        action="store_true",
        help="Print only the final rendered answer text, nothing else",
    )
    p.add_argument(
        "--no-color",
        action="store_true",
        help="Disable ANSI colour codes (useful for CI or piped output)",
    )
    p.add_argument(
        "--timeout", "-t",
        type=int,
        default=180,
        metavar="SECONDS",
        help="SSE connection timeout in seconds (default: 180)",
    )
    p.add_argument(
        "--suite", "-s",
        action="store_true",
        help="Run the full conformance test suite (multiple scenarios)",
    )
    p.add_argument(
        "--report", "-r",
        nargs="?",
        const="auto",
        metavar="FILE",
        help="Generate a markdown report (default: tests/reports/streaming_YYYY-MM-DD_HHMMSS.md)",
    )
    return p


# ── ANSI helpers ──────────────────────────────────────────────────────────────
_COLOR = True   # set by --no-color

def _c(code: str, text: str) -> str:
    return f"{code}{text}\033[0m" if _COLOR else text

def BOLD(t):   return _c("\033[1m", t)
def DIM(t):    return _c("\033[2m", t)
def CYAN(t):   return _c("\033[36m", t)
def GREEN(t):  return _c("\033[32m", t)
def YELLOW(t): return _c("\033[33m", t)
def RED(t):    return _c("\033[31m", t)
def BLUE(t):   return _c("\033[34m", t)
def GREY(t):   return _c("\033[90m", t)

def hdr(label: str, color_fn=CYAN, width: int = 72):
    bar = "─" * width
    print(f"\n{color_fn(bar)}")
    print(f"  {color_fn(BOLD(label))}")
    print(color_fn(bar))

def tag(label: str, color_fn=GREY) -> str:
    return color_fn(f"[{label}]")

def _fmt_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.1f}s"
    return f"{int(seconds // 60)}m{int(seconds % 60)}s"


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


# ── Fake Slack client — records and renders what Slack would receive ──────────
class FakeSlackClient:
    def __init__(self, verbose: bool = False, answer_only: bool = False):
        self._verbose     = verbose
        self._answer_only = answer_only
        self._stream_ts   = None
        self._stream_chunks: list[str] = []
        self._stop_chunks: list[str]   = []
        self._append_calls = 0
        self._block_calls  = 0

    # ---- startStream --------------------------------------------------------
    def chat_startStream(self, *, channel, thread_ts, **kwargs):
        self._stream_ts = f"fake-{uuid.uuid4().hex[:8]}"
        if not self._answer_only:
            print(f"  {tag('STREAM', BLUE)} opened  ts={self._stream_ts}")
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
                if self._verbose and not self._answer_only:
                    print(f"  {DIM(f'┊ appendStream text ({len(text)}c)')}  {GREY(repr(text[:80]))}")
            else:
                self._block_calls += 1
                if self._verbose and not self._answer_only:
                    block_id = chunk.get("id", chunk.get("type", "block"))
                    status   = chunk.get("status", "")
                    label    = f"{block_id[:20]}:{status}" if status else block_id[:24]
                    print(f"  {DIM('┊ appendStream block')}  {GREY(label)}")
        return {"ok": True}

    # ---- stopStream ---------------------------------------------------------
    def chat_stopStream(self, *, channel, ts, chunks=None, blocks=None, **kwargs):
        if chunks:
            for c in chunks:
                text = c.get("text", "")
                self._stop_chunks.append(text)
        return {"ok": True}

    # ---- render final answer ────────────────────────────────────────────────
    def render_answer(self, answer_only: bool = False):
        streamed = "".join(self._stream_chunks)
        stopped  = "".join(self._stop_chunks)

        if answer_only:
            # Bare answer text only — no decoration
            print(stopped or streamed)
            return

        hdr("What Slack Rendered", BOLD)

        # Delivery method badge
        if streamed and not stopped:
            badge = GREEN("● live stream")
            how   = f"appendStream — {self._append_calls} text call{'s' if self._append_calls != 1 else ''}, {self._block_calls} block call{'s' if self._block_calls != 1 else ''}"
        elif stopped and not streamed:
            badge = YELLOW("● stopStream only")
            how   = f"{len(stopped)} chars delivered at close"
        elif streamed and stopped:
            badge = YELLOW("⚠ split delivery")
            how   = "narration via appendStream + answer via stopStream"
        else:
            badge = RED("✗ empty")
            how   = "nothing delivered"

        print(f"\n  {badge}  {DIM(how)}")

        # Show the actual text the user would read (narration + answer joined)
        full_text = streamed + stopped
        if full_text:
            print()
            # Dim the narration lines (short lines before the real answer starts)
            lines = full_text.splitlines(keepends=True)
            print("".join(lines))

        # Duplicate detection
        if streamed and stopped:
            if stopped[:120].strip() in streamed or streamed[-120:].strip() in stopped:
                print(f"\n  {RED(BOLD('⚠  DUPLICATE DETECTED: same content in both streams!'))}")
            # else: split delivery is expected (narration + answer)

    def summary_stats(self) -> dict:
        return {
            "append_text_calls": self._append_calls,
            "append_block_calls": self._block_calls,
            "streamed_chars": sum(len(c) for c in self._stream_chunks),
            "stopped_chars": sum(len(c) for c in self._stop_chunks),
        }


# ── A2A SSE client ────────────────────────────────────────────────────────────
def sse_stream(question: str, base_url: str, timeout: int):
    client = A2AClient(base_url, timeout=timeout)
    yield from client.send_message_stream(question)


# ── Core simulation — mirrors stream_a2a_response exactly ────────────────────
def simulate(question: str, base_url: str, timeout: int,
             verbose: bool, answer_only: bool) -> int:
    """Run the simulation. Returns 0 on success, 1 on detected failure."""

    slack = FakeSlackClient(verbose=verbose, answer_only=answer_only)
    channel_id = "C_FAKE"
    thread_ts  = "fake-thread"

    # State mirrors ai.py
    stream_ts              = None
    stream_buf: StreamBuffer | None = None
    plan_steps: dict       = {}
    sent_step_status: dict = {}   # noqa: F841
    any_subagent_completed  = False
    streaming_final_answer  = False
    needs_separator         = False
    current_step_id         = None
    final_result_text       = None
    partial_result_text     = None

    event_counts: dict[str, int] = {}
    tool_counts:  dict[str, int] = {}   # name → call count (for summary)
    final_chunk_count = 0
    final_chunk_chars = 0

    t_start = time.monotonic()

    def _start_stream_if_needed():
        nonlocal stream_ts, stream_buf
        if stream_ts:
            return
        resp = slack.chat_startStream(channel=channel_id, thread_ts=thread_ts)
        stream_ts = resp["ts"]
        stream_buf = StreamBuffer(slack, channel_id, stream_ts)

    def _log(*args, **kwargs):
        """Print only when not in answer-only mode."""
        if not answer_only:
            print(*args, **kwargs)

    if not answer_only:
        hdr(f"Query: {question!r}  •  {base_url}", BOLD)

    for result in sse_stream(question, base_url, timeout):
        parsed = parse_event(result)
        kind   = parsed.event_type
        event_counts[kind.value] = event_counts.get(kind.value, 0) + 1

        # ── STREAMING_RESULT ──────────────────────────────────────────────
        if kind == EventType.STREAMING_RESULT:
            text = parsed.text_content or ""
            meta = (parsed.artifact or {}).get("metadata", {})
            step_id = meta.get("plan_step_id")
            is_final_answer_chunk = meta.get("is_final_answer", False)
            if step_id:
                current_step_id = step_id

            if is_final_answer_chunk and verbose:
                _log(f"  {tag('FINAL CHUNK', GREEN)} ({len(text)}c)  "
                     f"{GREY(repr(text[:60]))}")

            # Deterministic chunker tags its chunks with is_final_answer=True.
            # Latch so FINAL_RESULT handler skips re-streaming (prevents duplicate).
            if is_final_answer_chunk and not streaming_final_answer:
                streaming_final_answer = True

            if any_subagent_completed:
                if not stream_ts:
                    if verbose:
                        _log(f"  {GREY(f'suppress pre-stream post-subagent chunk ({len(text)}c)')}")
                    continue
                # Only latch when ALL plan steps are done — prevents intermediate
                # sub-agent narration from prematurely blocking the real answer.
                all_steps_done = not plan_steps or all(
                    s.get("status") == "completed" for s in plan_steps.values()
                )
                if all_steps_done:
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
                        if streaming_final_answer:
                            final_chunk_count += 1
                            final_chunk_chars += len(text)

        # ── FINAL_RESULT ─────────────────────────────────────────────────
        elif kind == EventType.FINAL_RESULT:
            if parsed.text_content:
                final_result_text = parsed.text_content
                if not answer_only:
                    if streaming_final_answer:
                        _log(f"\n  {tag('FINAL_RESULT', GREEN)} {len(parsed.text_content)}c  "
                             f"{GREEN('→ skip (already streamed)')}")
                    elif plan_steps:
                        _log(f"\n  {tag('FINAL_RESULT', YELLOW)} {len(parsed.text_content)}c  "
                             f"{YELLOW('→ defer to stopStream.chunks')}")
                    else:
                        _log(f"\n  {tag('FINAL_RESULT', CYAN)} {len(parsed.text_content)}c  "
                             f"{CYAN('→ streaming now')}")
                if streaming_final_answer:
                    pass  # already streamed
                elif plan_steps:
                    pass  # defer to finalization
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
            tool_counts[name] = tool_counts.get(name, 0) + 1
            if verbose:
                _log(f"  {tag('TOOL ▶', YELLOW)} {name}")
            needs_separator = True

        # ── TOOL_NOTIFICATION_END ─────────────────────────────────────────
        elif kind == EventType.TOOL_NOTIFICATION_END:
            name = (parsed.tool_notification.tool_name if parsed.tool_notification else "?")
            if verbose:
                _log(f"  {tag('TOOL ■', YELLOW)} {name}")
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
                        sid = s["step_id"][:16]
                        title = s.get("title", sid)
                        _log(f"  {tag('PLAN ✓', GREEN)} {title!r}")
                    elif verbose and s.get("status") == "in_progress":
                        sid = s["step_id"][:16]
                        title = s.get("title", sid)
                        _log(f"  {tag('PLAN ●', YELLOW)} {title!r}")
                _start_stream_if_needed()
                if stream_ts:
                    fake_chunks = [{"type": "plan_block", "id": s["step_id"],
                                    "status": s.get("status", "?")} for s in steps]
                    slack.chat_appendStream(channel=channel_id, ts=stream_ts, chunks=fake_chunks)

        # ── STATUS_UPDATE (completed) ─────────────────────────────────────
        elif kind == EventType.STATUS_UPDATE:
            state = (parsed.status or {}).get("state", "")
            if state == "completed":
                elapsed = time.monotonic() - t_start
                _log(f"  {tag('DONE', GREEN)} task completed  {DIM(_fmt_duration(elapsed))}")
                break

    # ── Finalization ──────────────────────────────────────────────────────
    _start_stream_if_needed()
    if stream_buf:
        stream_buf.flush()

    streamed_any_text = stream_buf.has_flushed if stream_buf else False
    already_streamed  = streaming_final_answer or (
        not plan_steps and streamed_any_text and not final_result_text
    )
    needs_final = not already_streamed
    final_text  = final_result_text or partial_result_text or ""

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

    elapsed_total = time.monotonic() - t_start

    # ── Summary ───────────────────────────────────────────────────────────
    if not answer_only:
        # Tool summary line
        if tool_counts:
            tool_summary = "  ".join(
                f"{n}×{c}" for n, c in sorted(tool_counts.items(), key=lambda x: -x[1])
            )
            _log(f"\n  {tag('TOOLS', CYAN)}  {DIM(tool_summary)}")

        # Chunk summary — only shown when answer was streamed live in chunks
        if final_chunk_count:
            _log(f"  {tag('CHUNKS', GREEN)}  "
                 f"{final_chunk_count} streaming chunks  "
                 f"({final_chunk_chars}c total)  "
                 f"{DIM('→ answer delivered word-by-word')}")

        # State flags
        _log(f"\n  {DIM('streaming_final_answer')} = "
             f"{GREEN(str(streaming_final_answer)) if streaming_final_answer else YELLOW(str(streaming_final_answer))}"
             f"    {DIM('already_streamed')} = "
             f"{GREEN(str(already_streamed)) if already_streamed else YELLOW(str(already_streamed))}"
             f"    {DIM('plan_steps')} = {len(plan_steps)}")

        # Event counts (compact)
        ec_str = "  ".join(f"{k}={v}" for k, v in sorted(event_counts.items()))
        _log(f"  {DIM('events:')}  {DIM(ec_str)}")

    # Render the answer
    slack.render_answer(answer_only=answer_only)

    # ── Verdict ───────────────────────────────────────────────────────────
    if not answer_only:
        stats = slack.summary_stats()
        total_chars = stats["streamed_chars"] + stats["stopped_chars"]
        has_answer  = total_chars > 0

        # Detect issues
        issues = []
        if not has_answer:
            issues.append("NO OUTPUT — nothing delivered to the user")
        if stats["streamed_chars"] > 0 and stats["stopped_chars"] > 0:
            streamed = "".join(slack._stream_chunks)
            stopped  = "".join(slack._stop_chunks)
            if stopped[:120].strip() in streamed or streamed[-120:].strip() in stopped:
                issues.append("DUPLICATE — same content in both streams")

        hdr("Result", BOLD)
        if issues:
            for issue in issues:
                print(f"  {RED(BOLD('✗ FAIL'))}  {RED(issue)}")
        else:
            delivery = "live stream" if stats["streamed_chars"] > 0 and stats["stopped_chars"] == 0 \
                       else "stopStream" if stats["stopped_chars"] > 0 and stats["streamed_chars"] == 0 \
                       else "split (narration+answer)"
            print(f"  {GREEN(BOLD('✓ PASS'))}  {total_chars}c delivered via {delivery}"
                  f"  •  {_fmt_duration(elapsed_total)}"
                  f"  •  {stats['append_text_calls']} appendStream calls")

    rc = 1 if (not answer_only and not (slack.summary_stats()["streamed_chars"] + slack.summary_stats()["stopped_chars"])) else 0

    # Return structured results for suite mode
    stats = slack.summary_stats()
    return {
        "exit_code": rc,
        "total_chars": stats["streamed_chars"] + stats["stopped_chars"],
        "streamed_chars": stats["streamed_chars"],
        "stopped_chars": stats["stopped_chars"],
        "append_text_calls": stats["append_text_calls"],
        "streaming_final_answer": streaming_final_answer,
        "already_streamed": already_streamed,
        "plan_steps": len(plan_steps),
        "tool_counts": dict(tool_counts),
        "event_counts": dict(event_counts),
        "final_chunk_count": final_chunk_count,
        "elapsed": elapsed_total,
        "stream_opened": stream_ts is not None,
    }


# ── Conformance Test Suite ────────────────────────────────────────────────────

# Each scenario defines: query, description, and conformance checks.
# Checks are callables (result_dict) -> (passed: bool, detail: str).
SCENARIOS = [
    {
        "name": "simple-chat",
        "query": "tell me a joke",
        "description": "Simple non-tool query — no RAG, no plan",
        "checks": [
            ("content_delivered",
             "Response must have content (>20 chars)",
             lambda r: (r["total_chars"] > 20,
                        f"{r['total_chars']}c delivered")),
            ("stream_opened",
             "Stream must be opened (startStream called)",
             lambda r: (r["stream_opened"],
                        "opened" if r["stream_opened"] else "never opened")),
            ("live_streamed",
             "Answer delivered via appendStream (not just stopStream)",
             lambda r: (r["streamed_chars"] > 0,
                        f"{r['streamed_chars']}c via appendStream")),
            ("no_duplicate",
             "No duplicate content in both appendStream and stopStream",
             lambda r: (not (r["streamed_chars"] > 0 and r["stopped_chars"] > 0),
                        f"appendStream={r['streamed_chars']}c, stopStream={r['stopped_chars']}c")),
            ("final_answer_latched",
             "streaming_final_answer must be True",
             lambda r: (r["streaming_final_answer"],
                        str(r["streaming_final_answer"]))),
            ("no_tools",
             "No tools should fire for a casual chat query",
             lambda r: (len(r["tool_counts"]) == 0,
                        f"tools: {r['tool_counts']}" if r["tool_counts"] else "none")),
        ],
    },
    {
        "name": "off-topic",
        "query": "how is the weather in San Francisco?",
        "description": "Off-topic query — should still return a response",
        "checks": [
            ("content_delivered",
             "Response must have content (>20 chars)",
             lambda r: (r["total_chars"] > 20,
                        f"{r['total_chars']}c delivered")),
            ("stream_opened",
             "Stream must be opened",
             lambda r: (r["stream_opened"],
                        "opened" if r["stream_opened"] else "never opened")),
            ("live_streamed",
             "Answer delivered via appendStream",
             lambda r: (r["streamed_chars"] > 0,
                        f"{r['streamed_chars']}c via appendStream")),
            ("final_answer_latched",
             "streaming_final_answer must be True",
             lambda r: (r["streaming_final_answer"],
                        str(r["streaming_final_answer"]))),
        ],
    },
    {
        "name": "rag-simple",
        "query": "what is agntcy",
        "description": "RAG query — should use search/fetch tools and stream answer",
        "checks": [
            ("content_delivered",
             "Response must have substantial content (>200 chars)",
             lambda r: (r["total_chars"] > 200,
                        f"{r['total_chars']}c delivered")),
            ("stream_opened",
             "Stream must be opened",
             lambda r: (r["stream_opened"],
                        "opened" if r["stream_opened"] else "never opened")),
            ("live_streamed",
             "Answer delivered via appendStream (word-by-word)",
             lambda r: (r["streamed_chars"] > 0,
                        f"{r['streamed_chars']}c via appendStream")),
            ("tools_used",
             "RAG tools (search/fetch_document) must be called",
             lambda r: (any(t in r["tool_counts"] for t in ("search", "fetch_document")),
                        f"tools: {r['tool_counts']}")),
            ("no_duplicate",
             "No duplicate content in both streams",
             lambda r: (not (r["streamed_chars"] > 0 and r["stopped_chars"] > 0),
                        f"appendStream={r['streamed_chars']}c, stopStream={r['stopped_chars']}c")),
            ("final_answer_latched",
             "streaming_final_answer must be True",
             lambda r: (r["streaming_final_answer"],
                        str(r["streaming_final_answer"]))),
            ("multi_chunk",
             "Answer should arrive in multiple streaming chunks (>1)",
             lambda r: (r["final_chunk_count"] > 1,
                        f"{r['final_chunk_count']} chunks")),
        ],
    },
    {
        "name": "rag-complex",
        "query": "explain how agntcy agents communicate with each other",
        "description": "Complex RAG query — multi-search, should produce long answer",
        "checks": [
            ("content_delivered",
             "Response must have substantial content (>300 chars)",
             lambda r: (r["total_chars"] > 300,
                        f"{r['total_chars']}c delivered")),
            ("stream_opened",
             "Stream must be opened",
             lambda r: (r["stream_opened"],
                        "opened" if r["stream_opened"] else "never opened")),
            ("live_streamed",
             "Answer delivered via appendStream",
             lambda r: (r["streamed_chars"] > 0,
                        f"{r['streamed_chars']}c via appendStream")),
            ("tools_used",
             "RAG tools must be called",
             lambda r: (any(t in r["tool_counts"] for t in ("search", "fetch_document")),
                        f"tools: {r['tool_counts']}")),
            ("final_answer_latched",
             "streaming_final_answer must be True",
             lambda r: (r["streaming_final_answer"],
                        str(r["streaming_final_answer"]))),
        ],
    },
]


def run_suite(base_url: str, timeout: int, verbose: bool,
              report_path: str | None = None) -> int:
    """Run all conformance scenarios and report results. Returns exit code."""
    hdr("Slack Streaming Conformance Suite", BOLD, width=76)
    print(f"  {DIM(f'Target: {base_url}  •  {len(SCENARIOS)} scenarios')}\n")

    all_results = []
    total_checks = 0
    total_passed = 0
    total_failed = 0

    suite_start = time.monotonic()

    for i, scenario in enumerate(SCENARIOS):
        name  = scenario["name"]
        query = scenario["query"]
        desc  = scenario["description"]

        print(f"\n  {BOLD(f'[{i+1}/{len(SCENARIOS)}]')} {CYAN(name)}")
        print(f"  {DIM(desc)}")
        print(f"  {DIM(f'Query: {query!r}')}\n")

        try:
            result = simulate(
                question=query,
                base_url=base_url,
                timeout=timeout,
                verbose=verbose,
                answer_only=False,
            )
        except Exception as e:
            print(f"  {RED(BOLD('✗ ERROR'))}  {RED(str(e))}")
            all_results.append({"name": name, "error": str(e), "checks": []})
            total_failed += len(scenario["checks"])
            total_checks += len(scenario["checks"])
            continue

        # Run conformance checks
        check_results = []
        for check_id, check_desc, check_fn in scenario["checks"]:
            total_checks += 1
            try:
                passed, detail = check_fn(result)
            except Exception as e:
                passed, detail = False, f"check error: {e}"

            check_results.append({
                "id": check_id, "desc": check_desc,
                "passed": passed, "detail": detail,
            })
            if passed:
                total_passed += 1
                mark = GREEN("  ✓")
            else:
                total_failed += 1
                mark = RED("  ✗")
            print(f"  {mark} {check_desc}  {DIM(f'({detail})')}")

        all_results.append({"name": name, "result": result, "checks": check_results})

    suite_elapsed = time.monotonic() - suite_start

    # ── Suite Summary ──────────────────────────────────────────────────────
    hdr("Suite Summary", BOLD, width=76)

    for entry in all_results:
        name = entry["name"]
        if "error" in entry:
            print(f"  {RED('✗')} {name}: {RED('ERROR')} — {entry['error']}")
            continue
        checks = entry["checks"]
        failed = [c for c in checks if not c["passed"]]
        elapsed = entry["result"]["elapsed"]
        if failed:
            print(f"  {RED('✗')} {name}: {RED(f'{len(failed)} FAILED')} / {len(checks)} checks  {DIM(_fmt_duration(elapsed))}")
            for f in failed:
                print(f"      {RED('→')} {f['desc']}  {DIM('(' + f['detail'] + ')')}")
        else:
            print(f"  {GREEN('✓')} {name}: {GREEN('ALL PASSED')} ({len(checks)} checks)  {DIM(_fmt_duration(elapsed))}")

    print()
    if total_failed == 0:
        print(f"  {GREEN(BOLD(f'✓ ALL {total_checks} CHECKS PASSED'))} across {len(SCENARIOS)} scenarios")
    else:
        print(f"  {RED(BOLD(f'✗ {total_failed} FAILED'))}, {GREEN(f'{total_passed} passed')} / {total_checks} checks")

    # ── Generate report if requested ──────────────────────────────────────
    if report_path:
        out = _generate_report(
            all_results=all_results,
            base_url=base_url,
            total_passed=total_passed,
            total_failed=total_failed,
            total_checks=total_checks,
            suite_elapsed=suite_elapsed,
            report_path=report_path,
        )
        print(f"\n  {BOLD('Report written to:')} {out}")

    return 1 if total_failed > 0 else 0


def _generate_report(all_results: list[dict], base_url: str,
                     total_passed: int, total_failed: int, total_checks: int,
                     suite_elapsed: float, report_path: str) -> str:
    """Generate a markdown conformance report and write to disk."""
    now = datetime.datetime.now(datetime.timezone.utc)
    ts = now.strftime("%Y-%m-%d %H:%M:%S UTC")

    verdict = "PASS" if total_failed == 0 else "FAIL"

    lines = [
        "# Slack Streaming Conformance Report",
        "",
        "| Field | Value |",
        "|-------|-------|",
        f"| **Date** | {ts} |",
        f"| **Target** | `{base_url}` |",
        f"| **Scenarios** | {len(all_results)} |",
        f"| **Total Checks** | {total_checks} |",
        f"| **Passed** | {total_passed} |",
        f"| **Failed** | {total_failed} |",
        f"| **Verdict** | **{verdict}** |",
        f"| **Suite Duration** | {_fmt_duration(suite_elapsed)} |",
        "",
        "---",
        "",
        "## Scenario Results",
        "",
        "| # | Scenario | Query | Duration | Checks | Result |",
        "|---|----------|-------|----------|--------|--------|",
    ]

    for i, entry in enumerate(all_results, 1):
        name = entry["name"]
        if "error" in entry:
            lines.append(
                f"| {i} | `{name}` | _(error)_ | - | 0/? | **ERROR** |"
            )
            continue
        result = entry["result"]
        checks = entry["checks"]
        n_passed = sum(1 for c in checks if c["passed"])
        elapsed = _fmt_duration(result["elapsed"])
        status = "PASS" if n_passed == len(checks) else "FAIL"
        query = next((s["query"] for s in SCENARIOS if s["name"] == name), "?")
        lines.append(
            f"| {i} | `{name}` | {query} | {elapsed} | {n_passed}/{len(checks)} | **{status}** |"
        )

    lines += ["", "---", "", "## Per-Query Streaming Metrics", ""]
    lines.append(
        "| Scenario | Total Chars | Streamed (append) | Stopped | "
        "Append Calls | Final Chunks | Tools | Delivery |"
    )
    lines.append(
        "|----------|------------|-------------------|---------|"
        "-------------|-------------|-------|----------|"
    )

    for entry in all_results:
        name = entry["name"]
        if "error" in entry:
            lines.append(f"| `{name}` | - | - | - | - | - | - | ERROR |")
            continue
        r = entry["result"]
        tools_str = ", ".join(
            f"{n}({c})" for n, c in sorted(r["tool_counts"].items())
        ) or "none"
        if r["streamed_chars"] > 0 and r["stopped_chars"] == 0:
            delivery = "live stream"
        elif r["stopped_chars"] > 0 and r["streamed_chars"] == 0:
            delivery = "stopStream only"
        elif r["streamed_chars"] > 0 and r["stopped_chars"] > 0:
            delivery = "split"
        else:
            delivery = "empty"
        lines.append(
            f"| `{name}` | {r['total_chars']} | {r['streamed_chars']} | "
            f"{r['stopped_chars']} | {r['append_text_calls']} | "
            f"{r['final_chunk_count']} | {tools_str} | {delivery} |"
        )

    lines += ["", "---", "", "## Conformance Check Details", ""]

    for entry in all_results:
        name = entry["name"]
        if "error" in entry:
            lines += [f"### `{name}` — ERROR", "", f"```\n{entry['error']}\n```", ""]
            continue
        checks = entry["checks"]
        lines.append(f"### `{name}`")
        lines.append("")
        lines.append("| Check | Description | Result | Detail |")
        lines.append("|-------|-------------|--------|--------|")
        for c in checks:
            mark = "PASS" if c["passed"] else "**FAIL**"
            lines.append(
                f"| `{c['id']}` | {c['desc']} | {mark} | {c['detail']} |"
            )
        lines.append("")

    lines += [
        "---", "",
        "## State Flags Per Scenario", "",
        "| Scenario | streaming_final_answer | stream_opened | plan_steps | already_streamed |",
        "|----------|----------------------|---------------|------------|-----------------|",
    ]
    for entry in all_results:
        name = entry["name"]
        if "error" in entry:
            lines.append(f"| `{name}` | - | - | - | - |")
            continue
        r = entry["result"]
        lines.append(
            f"| `{name}` | {r['streaming_final_answer']} | {r['stream_opened']} | "
            f"{r['plan_steps']} | {r['already_streamed']} |"
        )

    lines += [
        "", "---", "",
        "## Event Counts", "",
        "| Scenario | " + " | ".join(
            sorted({k for e in all_results if "result" in e
                    for k in e["result"]["event_counts"]})
        ) + " |",
    ]
    all_event_keys = sorted({k for e in all_results if "result" in e
                             for k in e["result"]["event_counts"]})
    lines.append("| " + " | ".join(["----------"] + ["---"] * len(all_event_keys)) + " |")
    for entry in all_results:
        name = entry["name"]
        if "error" in entry:
            lines.append(f"| `{name}` | " + " | ".join(["-"] * len(all_event_keys)) + " |")
            continue
        ec = entry["result"]["event_counts"]
        lines.append(
            f"| `{name}` | " + " | ".join(str(ec.get(k, 0)) for k in all_event_keys) + " |"
        )

    lines += ["", "---", "",
              "_Generated by `simulate_slack_stream.py --suite --report`_"]

    content = "\n".join(lines) + "\n"
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w") as f:
        f.write(content)
    return report_path


if __name__ == "__main__":
    args = _build_parser().parse_args()

    if args.no_color:
        _COLOR = False

    report_path = None
    if args.report:
        if args.report == "auto":
            stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
            report_path = os.path.join("tests", "reports", f"streaming_{stamp}.md")
        else:
            report_path = args.report

    if args.suite:
        rc = run_suite(
            base_url=args.url,
            timeout=args.timeout,
            verbose=args.verbose,
            report_path=report_path,
        )
    else:
        result = simulate(
            question=args.query,
            base_url=args.url,
            timeout=args.timeout,
            verbose=args.verbose,
            answer_only=args.answer_only,
        )
        rc = result["exit_code"]
    sys.exit(rc)
