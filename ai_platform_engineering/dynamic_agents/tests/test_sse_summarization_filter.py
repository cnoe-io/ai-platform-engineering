"""Tests for filtering Deep Agents internal summarization stream chunks."""

from types import SimpleNamespace

from dynamic_agents.services.stream_encoders.agui_sse import AGUIStreamEncoder
from dynamic_agents.services.stream_encoders.custom_sse import CustomStreamEncoder


def _chunk(content: str, *, additional_kwargs: dict | None = None) -> SimpleNamespace:
    return SimpleNamespace(content=content, additional_kwargs=additional_kwargs or {})


def test_agui_sse_filters_summarization_metadata() -> None:
    enc = AGUIStreamEncoder()

    frames = enc._handle_messages((_chunk("internal summary"), {"lc_source": "summarization"}), ())

    assert frames == []
    assert enc.get_accumulated_content() == ""


def test_custom_sse_filters_summarization_metadata() -> None:
    enc = CustomStreamEncoder()

    frames = enc._handle_messages((_chunk("internal summary"), {"lc_source": "summarization"}), ())

    assert frames == []
    assert enc.get_accumulated_content() == ""


def test_agui_sse_filters_summary_message_marker() -> None:
    enc = AGUIStreamEncoder()
    summary_chunk = _chunk("internal summary", additional_kwargs={"lc_source": "summarization"})

    frames = enc._handle_messages((summary_chunk, {}), ())

    assert frames == []
    assert enc.get_accumulated_content() == ""
