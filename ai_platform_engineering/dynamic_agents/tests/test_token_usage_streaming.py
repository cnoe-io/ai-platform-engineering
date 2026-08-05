"""Unit tests for token usage metadata recording and normalization in stream encoders."""

from dataclasses import dataclass
from typing import Any

from dynamic_agents.services.stream_encoders.custom_sse import CustomStreamEncoder
from dynamic_agents.services.stream_encoders.langgraph_helpers import LangGraphStreamHelper


@dataclass
class MockMessageChunk:
    content: str
    usage_metadata: dict[str, Any] | None = None
    response_metadata: dict[str, Any] | None = None


def test_langgraph_helper_record_usage_langchain_format():
    """Verify record_usage normalizes LangChain input_tokens/output_tokens to prompt_tokens/completion_tokens."""
    helper = LangGraphStreamHelper()
    chunk1 = MockMessageChunk(
        content="Hello ",
        usage_metadata={"input_tokens": 100, "output_tokens": 10, "total_tokens": 110},
    )
    chunk2 = MockMessageChunk(
        content="world!",
        usage_metadata={"input_tokens": 100, "output_tokens": 25, "total_tokens": 125},
    )

    helper.record_usage(chunk1)
    helper.record_usage(chunk2)

    usage = helper.get_total_usage()
    assert usage == {
        "prompt_tokens": 100,
        "completion_tokens": 25,
        "total_tokens": 125,
    }


def test_langgraph_helper_record_usage_openai_format():
    """Verify record_usage handles standard OpenAI prompt_tokens/completion_tokens directly."""
    helper = LangGraphStreamHelper()
    chunk = MockMessageChunk(
        content="Testing",
        response_metadata={"token_usage": {"prompt_tokens": 50, "completion_tokens": 20, "total_tokens": 70}},
    )

    helper.record_usage(chunk)
    usage = helper.get_total_usage()
    assert usage == {
        "prompt_tokens": 50,
        "completion_tokens": 20,
        "total_tokens": 70,
    }


def test_custom_stream_encoder_done_event_with_usage():
    """Verify CustomStreamEncoder includes usage_metadata in the done event when usage is available."""
    encoder = CustomStreamEncoder()
    chunk = MockMessageChunk(
        content="Sample response",
        usage_metadata={"input_tokens": 200, "output_tokens": 30, "total_tokens": 230},
    )

    events = encoder.on_chunk(((), "messages", (chunk, {})))
    assert len(events) == 1
    assert "event: content" in events[0]

    finish_events = encoder.on_run_finish("run-123", "thread-456")
    assert len(finish_events) == 1
    assert "event: done" in finish_events[0]
    assert '"usage_metadata": {"prompt_tokens": 200, "completion_tokens": 30, "total_tokens": 230}' in finish_events[0]


def test_custom_stream_encoder_done_event_without_usage():
    """Verify CustomStreamEncoder outputs empty done event payload when no usage is recorded."""
    encoder = CustomStreamEncoder()
    chunk = MockMessageChunk(content="No usage info")

    encoder.on_chunk(((), "messages", (chunk, {})))
    finish_events = encoder.on_run_finish("run-123", "thread-456")

    assert len(finish_events) == 1
    assert "event: done\ndata: {}\n\n" in finish_events[0]


def test_langgraph_helper_record_usage_duplicate_cumulative_chunks():
    """Verify identical cumulative usage chunks (e.g. final text + finish_reason) do not inflate token counts."""
    helper = LangGraphStreamHelper()
    chunk1 = MockMessageChunk(
        content="Text",
        usage_metadata={"input_tokens": 100, "output_tokens": 20, "total_tokens": 120},
    )
    chunk2 = MockMessageChunk(
        content="",
        usage_metadata={"input_tokens": 100, "output_tokens": 20, "total_tokens": 120},
    )

    helper.record_usage(chunk1)
    helper.record_usage(chunk2)

    usage = helper.get_total_usage()
    assert usage == {
        "prompt_tokens": 100,
        "completion_tokens": 20,
        "total_tokens": 120,
    }


def test_custom_stream_encoder_include_usage_false():
    """Verify CustomStreamEncoder omits usage metadata when include_usage=False."""
    encoder = CustomStreamEncoder(include_usage=False)
    chunk = MockMessageChunk(
        content="Sample response",
        usage_metadata={"input_tokens": 200, "output_tokens": 30, "total_tokens": 230},
    )

    encoder.on_chunk(((), "messages", (chunk, {})))
    finish_events = encoder.on_run_finish("run-123", "thread-456")

    assert len(finish_events) == 1
    assert "event: done\ndata: {}\n\n" in finish_events[0]


def test_get_encoder_factory_include_usage():
    """Verify get_encoder factory propagates include_usage parameter."""
    from dynamic_agents.services.stream_encoders import get_encoder

    enc_with_usage = get_encoder("custom", include_usage=True)
    assert getattr(enc_with_usage, "include_usage", None) is True

    enc_without_usage = get_encoder("custom", include_usage=False)
    assert getattr(enc_without_usage, "include_usage", None) is False


def test_record_usage_zero_prompt_tokens_cached_response():
    """Verify prompt_tokens=0 (cached prompt hit) is correctly preserved rather than overwritten by fallbacks."""
    helper = LangGraphStreamHelper()
    chunk = MockMessageChunk(
        content="Cached response",
        usage_metadata={"prompt_tokens": 0, "completion_tokens": 15, "total_tokens": 15},
    )
    helper.record_usage(chunk)
    usage = helper.get_total_usage()
    assert usage == {"prompt_tokens": 0, "completion_tokens": 15, "total_tokens": 15}


def test_record_usage_invalid_non_integer_tokens():
    """Verify negative test: non-integer token counts are safely defaulted to 0 without raising exceptions."""
    helper = LangGraphStreamHelper()
    chunk = MockMessageChunk(
        content="Malformed usage",
        usage_metadata={"prompt_tokens": "not-an-int", "completion_tokens": None, "total_tokens": "abc"},
    )
    helper.record_usage(chunk)
    assert helper.get_total_usage() == {}


def test_record_usage_none_chunk():
    """Verify negative test: None chunk is safely ignored."""
    helper = LangGraphStreamHelper()
    helper.record_usage(None)
    assert helper.get_total_usage() == {}


def test_record_usage_object_form_usage():
    """Verify non-dict usage object (with prompt_tokens/completion_tokens attrs) is extracted correctly."""

    @dataclass
    class ObjectUsage:
        prompt_tokens: int
        completion_tokens: int
        total_tokens: int

    helper = LangGraphStreamHelper()
    chunk = MockMessageChunk(
        content="Object usage",
        usage_metadata=ObjectUsage(prompt_tokens=40, completion_tokens=10, total_tokens=50),
    )
    helper.record_usage(chunk)
    assert helper.get_total_usage() == {
        "prompt_tokens": 40,
        "completion_tokens": 10,
        "total_tokens": 50,
    }
