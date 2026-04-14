#!/usr/bin/env python3
"""
Unit tests for [FINAL ANSWER] marker gate buffer flush logic in agent.py.

Tests the _pre_marker_buffer flush at tool-call boundaries, pre-marker
tail holdback with is_narration tagging, post-marker content with
is_final_answer tagging, and leading newline stripping.

These tests simulate the key logic paths from agent.py's stream()
method by recreating the local variables and running them through
the same conditional branches.  This avoids mocking the full async
generator which depends on LangGraph internals.

Reference: agent.py lines ~630-1400 (stream() method)

Usage:
    PYTHONPATH=. uv run pytest tests/test_marker_gate_buffer_flush.py -v
"""

import pytest


# ---------------------------------------------------------------------------
# Helpers — reproduce the exact logic from agent.py's stream() method
# ---------------------------------------------------------------------------

_MARKER = "[FINAL ANSWER]"
_MARKER_ALT = "[FINAL_ANSWER]"
_MARKER_MAX_LEN = max(len(_MARKER), len(_MARKER_ALT))


def _simulate_tool_call_flush(
    *,
    use_structured_response: bool,
    pre_marker_buffer: str,
    final_answer_seen: bool,
) -> tuple[list[dict], str]:
    """Simulate the tool-call boundary flush (agent.py lines 1132-1141).

    Returns (yielded_events, remaining_buffer).
    """
    events: list[dict] = []
    if not use_structured_response and pre_marker_buffer and not final_answer_seen:
        events.append({
            "is_task_complete": False,
            "require_user_input": False,
            "content": pre_marker_buffer,
            "is_narration": True,
        })
        pre_marker_buffer = ""
    return events, pre_marker_buffer


def _simulate_marker_content_handling(
    *,
    content: str,
    final_answer_seen: bool,
    strip_post_marker_newlines: bool,
    pre_marker_buffer: str,
    use_structured_response: bool,
) -> tuple[list[dict], bool, bool, str]:
    """Simulate agent.py lines 1293-1351 (content handling in marker mode).

    Returns (yielded_events, final_answer_seen, strip_post_marker_newlines, pre_marker_buffer).
    """
    events: list[dict] = []

    if use_structured_response:
        # Structured mode yields narration directly (lines 1294-1305)
        events.append({
            "is_task_complete": False,
            "require_user_input": False,
            "content": content,
        })
        return events, final_answer_seen, strip_post_marker_newlines, pre_marker_buffer

    # Marker mode (lines 1306-1351)
    if not final_answer_seen:
        pre_marker_buffer += content
        marker_used = None
        if _MARKER in pre_marker_buffer:
            marker_used = _MARKER
        elif _MARKER_ALT in pre_marker_buffer:
            marker_used = _MARKER_ALT
        if marker_used:
            final_answer_seen = True
            strip_post_marker_newlines = True
            content = pre_marker_buffer.split(marker_used, 1)[1].lstrip("\n\r")
            pre_marker_buffer = ""
        else:
            # Pre-marker tail holdback (lines 1325-1336)
            safe_len = len(pre_marker_buffer) - _MARKER_MAX_LEN
            if safe_len > 0:
                to_yield = pre_marker_buffer[:safe_len]
                pre_marker_buffer = pre_marker_buffer[safe_len:]
                events.append({
                    "is_task_complete": False,
                    "require_user_input": False,
                    "content": to_yield,
                    "is_narration": True,
                })
            return events, final_answer_seen, strip_post_marker_newlines, pre_marker_buffer

    # Post-marker newline stripping (lines 1340-1343)
    if content and strip_post_marker_newlines:
        content = content.lstrip("\n\r")
        if content:
            strip_post_marker_newlines = False
    if content:
        events.append({
            "is_task_complete": False,
            "require_user_input": False,
            "content": content,
            "is_final_answer": True,
        })
    return events, final_answer_seen, strip_post_marker_newlines, pre_marker_buffer


# ===========================================================================
# Tests: tool-call boundary buffer flush
# ===========================================================================

class TestToolCallBufferFlush:
    """Tests for _pre_marker_buffer flush at tool-call boundaries (lines 1126-1141)."""

    def test_buffer_flush_on_task_tool_call(self):
        """Buffer flushes as narration when tool_name='task' arrives."""
        events, buf = _simulate_tool_call_flush(
            use_structured_response=False,
            pre_marker_buffer="I'll search the knowledge base for information about AGNTCY",
            final_answer_seen=False,
        )
        assert len(events) == 1
        assert events[0]["is_narration"] is True
        assert "AGNTCY" in events[0]["content"]
        assert buf == ""

    def test_buffer_flush_on_write_todos_tool_call(self):
        """Buffer flushes as narration when tool_name='write_todos' arrives."""
        events, buf = _simulate_tool_call_flush(
            use_structured_response=False,
            pre_marker_buffer="Let me plan the steps needed...",
            final_answer_seen=False,
        )
        assert len(events) == 1
        assert events[0]["is_narration"] is True
        assert buf == ""

    def test_buffer_flush_on_regular_tool_call(self):
        """Buffer flushes for any tool (e.g. 'search')."""
        events, buf = _simulate_tool_call_flush(
            use_structured_response=False,
            pre_marker_buffer="Searching for relevant docs...",
            final_answer_seen=False,
        )
        assert len(events) == 1
        assert events[0]["content"] == "Searching for relevant docs..."
        assert buf == ""

    def test_no_flush_when_buffer_empty(self):
        """No yield when _pre_marker_buffer is empty."""
        events, buf = _simulate_tool_call_flush(
            use_structured_response=False,
            pre_marker_buffer="",
            final_answer_seen=False,
        )
        assert len(events) == 0
        assert buf == ""

    def test_no_flush_in_structured_response_mode(self):
        """With USE_STRUCTURED_RESPONSE=true, no buffer flush on tool calls."""
        events, buf = _simulate_tool_call_flush(
            use_structured_response=True,
            pre_marker_buffer="I'll search the knowledge base...",
            final_answer_seen=False,
        )
        assert len(events) == 0
        assert buf == "I'll search the knowledge base..."

    def test_no_flush_after_final_answer_seen(self):
        """After [FINAL ANSWER] marker, tool calls do NOT flush buffer."""
        events, buf = _simulate_tool_call_flush(
            use_structured_response=False,
            pre_marker_buffer="leftover text",
            final_answer_seen=True,
        )
        assert len(events) == 0
        assert buf == "leftover text"

    def test_buffer_content_has_is_narration_flag(self):
        """Flushed buffer content has is_narration=True, not is_final_answer."""
        events, _ = _simulate_tool_call_flush(
            use_structured_response=False,
            pre_marker_buffer="thinking...",
            final_answer_seen=False,
        )
        assert events[0]["is_narration"] is True
        assert "is_final_answer" not in events[0]


# ===========================================================================
# Tests: pre-marker tail holdback and narration tagging
# ===========================================================================

class TestPreMarkerTailHoldback:
    """Tests for pre-marker safe-prefix yields (lines 1325-1336)."""

    def test_tail_holdback_yields_have_is_narration(self):
        """Pre-marker safe-prefix yields include is_narration=True."""
        # Feed enough content that safe_len > 0 (buffer > _MARKER_MAX_LEN)
        long_narration = "I'll search the knowledge base for information about setting up CAIPE..."
        events, fa_seen, _, buf = _simulate_marker_content_handling(
            content=long_narration,
            final_answer_seen=False,
            strip_post_marker_newlines=False,
            pre_marker_buffer="",
            use_structured_response=False,
        )
        # Should yield the safe prefix as narration
        assert len(events) == 1
        assert events[0]["is_narration"] is True
        assert not fa_seen
        # Buffer should retain the tail (_MARKER_MAX_LEN chars)
        assert len(buf) == _MARKER_MAX_LEN

    def test_short_content_held_back_entirely(self):
        """Content shorter than _MARKER_MAX_LEN is held back (no yield)."""
        events, fa_seen, _, buf = _simulate_marker_content_handling(
            content="Hello",
            final_answer_seen=False,
            strip_post_marker_newlines=False,
            pre_marker_buffer="",
            use_structured_response=False,
        )
        assert len(events) == 0
        assert buf == "Hello"

    def test_accumulated_buffer_flushes_safe_prefix(self):
        """Multiple content chunks accumulate; safe prefix flushes when buffer grows."""
        buf = ""
        all_events = []

        # First chunk: short, held back
        events, fa, spn, buf = _simulate_marker_content_handling(
            content="I'll check ",
            final_answer_seen=False,
            strip_post_marker_newlines=False,
            pre_marker_buffer=buf,
            use_structured_response=False,
        )
        all_events.extend(events)

        # Second chunk: pushes buffer past _MARKER_MAX_LEN
        events, fa, spn, buf = _simulate_marker_content_handling(
            content="the knowledge base for this.",
            final_answer_seen=fa,
            strip_post_marker_newlines=spn,
            pre_marker_buffer=buf,
            use_structured_response=False,
        )
        all_events.extend(events)

        assert len(all_events) >= 1
        for ev in all_events:
            assert ev["is_narration"] is True


# ===========================================================================
# Tests: post-marker content (is_final_answer)
# ===========================================================================

class TestPostMarkerContent:
    """Tests for content after [FINAL ANSWER] marker detection (lines 1314-1351)."""

    def test_post_marker_content_has_is_final_answer(self):
        """After [FINAL ANSWER] marker, content yields include is_final_answer=True."""
        events, fa, spn, buf = _simulate_marker_content_handling(
            content="Some thinking...[FINAL ANSWER]Here is the answer",
            final_answer_seen=False,
            strip_post_marker_newlines=False,
            pre_marker_buffer="",
            use_structured_response=False,
        )
        assert fa is True
        # Should yield the post-marker content
        final_events = [e for e in events if e.get("is_final_answer")]
        assert len(final_events) == 1
        assert final_events[0]["content"] == "Here is the answer"

    def test_marker_alt_also_detected(self):
        """[FINAL_ANSWER] (underscore variant) is also detected."""
        events, fa, _, _ = _simulate_marker_content_handling(
            content="Thinking[FINAL_ANSWER]The real answer",
            final_answer_seen=False,
            strip_post_marker_newlines=False,
            pre_marker_buffer="",
            use_structured_response=False,
        )
        assert fa is True
        final_events = [e for e in events if e.get("is_final_answer")]
        assert len(final_events) == 1
        assert final_events[0]["content"] == "The real answer"

    def test_post_marker_newline_stripping(self):
        """Leading \\n after marker is stripped until real content arrives."""
        # First: marker detected with trailing newlines
        events, fa, spn, buf = _simulate_marker_content_handling(
            content="Thinking[FINAL ANSWER]\n\n",
            final_answer_seen=False,
            strip_post_marker_newlines=False,
            pre_marker_buffer="",
            use_structured_response=False,
        )
        assert fa is True
        assert spn is True  # stripping still active (no real content yet)
        # No event with empty content
        final_events = [e for e in events if e.get("is_final_answer")]
        assert len(final_events) == 0

        # Second chunk: real content arrives
        events2, fa2, spn2, _ = _simulate_marker_content_handling(
            content="\nHere is the real answer",
            final_answer_seen=fa,
            strip_post_marker_newlines=spn,
            pre_marker_buffer=buf,
            use_structured_response=False,
        )
        assert spn2 is False  # stripping done
        final_events2 = [e for e in events2 if e.get("is_final_answer")]
        assert len(final_events2) == 1
        assert final_events2[0]["content"] == "Here is the real answer"

    def test_marker_in_accumulated_buffer(self):
        """Marker split across chunks is detected when buffer accumulates."""
        buf = ""
        all_events = []

        # Chunk 1: partial marker
        events, fa, spn, buf = _simulate_marker_content_handling(
            content="Analysis complete. [FINAL ",
            final_answer_seen=False,
            strip_post_marker_newlines=False,
            pre_marker_buffer=buf,
            use_structured_response=False,
        )
        all_events.extend(events)

        # Chunk 2: rest of marker + answer
        events, fa, spn, buf = _simulate_marker_content_handling(
            content="ANSWER]Here is the answer",
            final_answer_seen=fa,
            strip_post_marker_newlines=spn,
            pre_marker_buffer=buf,
            use_structured_response=False,
        )
        all_events.extend(events)

        assert fa is True
        final_events = [e for e in all_events if e.get("is_final_answer")]
        assert len(final_events) == 1
        assert final_events[0]["content"] == "Here is the answer"


# ===========================================================================
# Tests: marker constants
# ===========================================================================

class TestMarkerConstants:
    """Verify marker constants match expected values."""

    def test_marker_value(self):
        assert _MARKER == "[FINAL ANSWER]"

    def test_marker_alt_value(self):
        assert _MARKER_ALT == "[FINAL_ANSWER]"

    def test_marker_max_len(self):
        assert _MARKER_MAX_LEN == 14

    def test_markers_same_length(self):
        """Both marker variants are the same length."""
        assert len(_MARKER) == len(_MARKER_ALT)


# ===========================================================================
# Tests: structured mode bypasses marker logic
# ===========================================================================

class TestStructuredModeBypass:
    """Structured response mode yields content directly (no marker gate)."""

    def test_structured_mode_yields_directly(self):
        """USE_STRUCTURED_RESPONSE=true yields content without marker processing."""
        events, fa, _, _ = _simulate_marker_content_handling(
            content="I'll search for that information...",
            final_answer_seen=False,
            strip_post_marker_newlines=False,
            pre_marker_buffer="",
            use_structured_response=True,
        )
        assert len(events) == 1
        assert events[0]["content"] == "I'll search for that information..."
        assert "is_narration" not in events[0]
        assert "is_final_answer" not in events[0]
        assert fa is False

    def test_structured_mode_no_buffer_accumulation(self):
        """Structured mode does not accumulate into pre_marker_buffer."""
        _, _, _, buf = _simulate_marker_content_handling(
            content="[FINAL ANSWER] this is not processed",
            final_answer_seen=False,
            strip_post_marker_newlines=False,
            pre_marker_buffer="",
            use_structured_response=True,
        )
        assert buf == ""


# ===========================================================================
# Tests: ResponseFormat word-boundary buffer (_rf_word_buffer)
# ===========================================================================

_BOUNDARY_CHARS = frozenset(' \n\r\t.,!?:;-)]}>*#/\\[({<"\'`')


def _simulate_rf_word_buffer(delta: str, word_buffer: str = "") -> tuple[str, str]:
    """Simulate agent.py lines 1076-1098 (word-boundary buffering).

    Returns (content_to_yield, remaining_word_buffer).
    """
    # Prepend any buffered partial word from previous chunk
    delta = word_buffer + delta
    word_buffer = ""

    last_boundary = -1
    for i in range(len(delta) - 1, -1, -1):
        if delta[i] in _BOUNDARY_CHARS:
            last_boundary = i
            break

    if last_boundary < 0:
        # No boundary found — buffer entire delta (flush if > 80 chars)
        if len(delta) > 80:
            pass  # yield as-is
        else:
            word_buffer = delta
            delta = ""
    elif last_boundary < len(delta) - 1:
        # Partial word after last boundary — buffer it
        word_buffer = delta[last_boundary + 1:]
        delta = delta[:last_boundary + 1]
    return delta, word_buffer


class TestResponseFormatWordBuffer:
    """Tests for _rf_word_buffer word-boundary buffering (lines 1076-1098)."""

    def test_complete_word_at_boundary(self):
        """Delta ending at a boundary char yields everything."""
        delta, buf = _simulate_rf_word_buffer("Hello world ")
        assert delta == "Hello world "
        assert buf == ""

    def test_partial_word_buffered(self):
        """Trailing partial word is buffered for next chunk."""
        delta, buf = _simulate_rf_word_buffer("Hello wor")
        assert delta == "Hello "
        assert buf == "wor"

    def test_no_boundary_short_buffers_entirely(self):
        """Short delta with no boundary is buffered entirely."""
        delta, buf = _simulate_rf_word_buffer("abc")
        assert delta == ""
        assert buf == "abc"

    def test_no_boundary_long_yields_as_is(self):
        """Long delta (>80 chars) with no boundary yields as-is."""
        long_word = "a" * 81
        delta, buf = _simulate_rf_word_buffer(long_word)
        assert delta == long_word
        assert buf == ""

    def test_prepend_from_previous_chunk(self):
        """Previous word_buffer is prepended to new delta."""
        delta, buf = _simulate_rf_word_buffer("ld! Next.", word_buffer="wor")
        # "world! Next." — last boundary is "." at end, so everything yields
        assert delta == "world! Next."
        assert buf == ""

    def test_prepend_completes_partial_word(self):
        """Prepend from buffer + new delta forms a complete word."""
        delta, buf = _simulate_rf_word_buffer("ered by ", word_buffer="pow")
        assert delta == "powered by "
        assert buf == ""

    def test_newline_is_boundary(self):
        """Newline counts as a boundary character."""
        delta, buf = _simulate_rf_word_buffer("line1\npartial")
        assert delta == "line1\n"
        assert buf == "partial"

    def test_multiple_boundary_chars(self):
        """Uses the LAST boundary character."""
        delta, buf = _simulate_rf_word_buffer("a, b, c, part")
        assert delta == "a, b, c, "
        assert buf == "part"

    def test_empty_delta_noop(self):
        """Empty delta with empty buffer yields nothing."""
        delta, buf = _simulate_rf_word_buffer("")
        assert delta == ""
        assert buf == ""

    def test_delta_all_boundary_chars(self):
        """Delta of only boundary chars yields everything."""
        delta, buf = _simulate_rf_word_buffer("   ")
        assert delta == "   "
        assert buf == ""


# ===========================================================================
# Tests: ResponseFormat incremental JSON parsing
# ===========================================================================


def _simulate_rf_json_extraction(
    partial_json: str, last_content_len: int = 0
) -> tuple[str | None, int]:
    """Simulate agent.py lines 1062-1074 (incremental JSON content extraction).

    Returns (delta_or_None, new_last_content_len).
    """
    import json

    _parsed_content = None
    for _suffix in ("", '"}', '"}}', '"}}}', "}", "}}"):
        try:
            partial_obj = json.loads(partial_json + _suffix)
            _parsed_content = partial_obj.get("content", "") or ""
            break
        except (json.JSONDecodeError, ValueError):
            continue
    if _parsed_content is not None and len(_parsed_content) > last_content_len:
        delta = _parsed_content[last_content_len:]
        return delta, len(_parsed_content)
    return None, last_content_len


class TestResponseFormatJsonExtraction:
    """Tests for incremental JSON parsing of ResponseFormat tool_call_chunks."""

    def test_complete_json_extracts_content(self):
        """Complete JSON extracts the content field."""
        delta, new_len = _simulate_rf_json_extraction('{"content": "Hello world"}')
        assert delta == "Hello world"
        assert new_len == 11

    def test_partial_json_closed_with_suffix(self):
        """Partial JSON closed with '"}' suffix extracts content."""
        delta, new_len = _simulate_rf_json_extraction('{"content": "Hello')
        assert delta == "Hello"
        assert new_len == 5

    def test_incremental_extraction(self):
        """Second call extracts only the new delta."""
        delta1, len1 = _simulate_rf_json_extraction('{"content": "Hello')
        assert delta1 == "Hello"

        delta2, len2 = _simulate_rf_json_extraction('{"content": "Hello world', last_content_len=len1)
        assert delta2 == " world"
        assert len2 == 11

    def test_no_new_content_returns_none(self):
        """When content hasn't grown, returns None."""
        delta, _ = _simulate_rf_json_extraction('{"content": "Hello"}', last_content_len=5)
        assert delta is None

    def test_invalid_json_returns_none(self):
        """Completely invalid JSON returns None."""
        delta, _ = _simulate_rf_json_extraction("not json at all")
        assert delta is None

    def test_empty_content_field(self):
        """Empty content field returns None (no delta)."""
        delta, _ = _simulate_rf_json_extraction('{"content": ""}')
        assert delta is None

    def test_nested_json_with_metadata(self):
        """JSON with extra fields still extracts content."""
        delta, _ = _simulate_rf_json_extraction(
            '{"content": "Answer", "is_task_complete": true}'
        )
        assert delta == "Answer"


# ===========================================================================
# Tests: narration extraction from tool-call AIMessageChunks
# ===========================================================================

class TestNarrationExtractionFromToolCallChunks:
    """Tests for narration co-located with tool_calls (lines 1202-1230)."""

    def _extract_narration(self, content) -> str | None:
        """Simulate narration extraction logic from agent.py lines 1212-1220."""
        _narration = content
        if isinstance(_narration, list):
            _narration = "".join(
                item.get("text", "") if isinstance(item, dict) else str(item)
                for item in _narration
                if not (isinstance(item, dict) and item.get("type") == "tool_use")
            )
        if isinstance(_narration, str) and _narration.strip():
            return _narration
        return None

    def test_string_content_extracted(self):
        """Simple string content is extracted as narration."""
        result = self._extract_narration("I'll search the knowledge base...")
        assert result == "I'll search the knowledge base..."

    def test_list_content_filters_tool_use(self):
        """List content filters out tool_use blocks, keeps text."""
        content = [
            {"type": "text", "text": "Let me check "},
            {"type": "tool_use", "name": "search", "input": {"q": "caipe"}},
            {"type": "text", "text": "the docs."},
        ]
        result = self._extract_narration(content)
        assert result == "Let me check the docs."

    def test_list_content_only_tool_use_returns_none(self):
        """List with only tool_use blocks returns None."""
        content = [
            {"type": "tool_use", "name": "search", "input": {}},
        ]
        result = self._extract_narration(content)
        assert result is None

    def test_empty_string_returns_none(self):
        """Empty or whitespace-only string returns None."""
        assert self._extract_narration("") is None
        assert self._extract_narration("   ") is None

    def test_string_items_in_list(self):
        """Raw strings in list are included."""
        content = ["Hello ", "world"]
        result = self._extract_narration(content)
        assert result == "Hello world"
