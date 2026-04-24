# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for SanitizeToolNamesMiddleware.

Verifies that tool_use names containing XML artifacts (produced when the model
hallucinates ``<invoke name="..." />`` style calls) are stripped to their valid
leading ``[a-zA-Z0-9_-]+`` portion before being sent to Bedrock ConverseStream.
"""

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from ai_platform_engineering.utils.deepagents_custom.sanitize_tool_names_middleware import (
    SanitizeToolNamesMiddleware,
    _sanitize_name,
)


# ---------------------------------------------------------------------------
# _sanitize_name unit tests
# ---------------------------------------------------------------------------

def test_sanitize_name_already_valid():
    assert _sanitize_name("get_current_date") == "get_current_date"


def test_sanitize_name_with_xml_suffix():
    # Exact artifact observed in production trace 46a74faf
    assert _sanitize_name('get_current_date" />\n</invoke>') == "get_current_date"


def test_sanitize_name_with_space_suffix():
    assert _sanitize_name("my_tool some garbage") == "my_tool"


def test_sanitize_name_hyphen_and_underscore():
    assert _sanitize_name("my-tool_name") == "my-tool_name"


def test_sanitize_name_no_valid_prefix_returns_original():
    # No leading valid chars — return as-is so Bedrock surfaces the error
    bad = " no-leading-valid"
    assert _sanitize_name(bad) == bad


# ---------------------------------------------------------------------------
# SanitizeToolNamesMiddleware.before_agent tests
# ---------------------------------------------------------------------------

def _make_state(*messages):
    return {"messages": list(messages)}


def test_no_messages_returns_none():
    mw = SanitizeToolNamesMiddleware()
    assert mw.before_agent({"messages": []}) is None


def test_no_ai_messages_returns_none():
    mw = SanitizeToolNamesMiddleware()
    state = _make_state(HumanMessage(content="hello"))
    assert mw.before_agent(state) is None


def test_valid_tool_names_returns_none():
    """If all names are already valid, the middleware should be a no-op."""
    mw = SanitizeToolNamesMiddleware()
    ai_msg = AIMessage(
        content="",
        tool_calls=[{"name": "get_current_date", "args": {}, "id": "tc1"}],
    )
    state = _make_state(HumanMessage(content="hi"), ai_msg)
    assert mw.before_agent(state) is None


def test_invalid_tool_name_is_sanitized():
    """AIMessage with XML-artifact name gets corrected in the returned messages."""
    mw = SanitizeToolNamesMiddleware()
    bad_name = 'get_current_date" />\n</invoke>'
    ai_msg = AIMessage(
        content="",
        tool_calls=[{"name": bad_name, "args": {}, "id": "tc1"}],
    )
    state = _make_state(HumanMessage(content="hi"), ai_msg)
    result = mw.before_agent(state)

    assert result is not None
    patched_messages = result["messages"].value  # Overwrite wraps the list
    ai_patched = next(m for m in patched_messages if isinstance(m, AIMessage))
    assert ai_patched.tool_calls[0]["name"] == "get_current_date"


def test_non_ai_messages_preserved():
    """HumanMessage and ToolMessage pass through unchanged."""
    mw = SanitizeToolNamesMiddleware()
    human = HumanMessage(content="hello")
    tool_msg = ToolMessage(content="result", tool_call_id="tc0", name="some_tool")
    bad_ai = AIMessage(
        content="",
        tool_calls=[{"name": 'foo" />\n</invoke>', "args": {}, "id": "tc1"}],
    )
    state = _make_state(human, tool_msg, bad_ai)
    result = mw.before_agent(state)

    assert result is not None
    patched = result["messages"].value
    assert patched[0] is human
    assert patched[1] is tool_msg


def test_multiple_tool_calls_partial_fix():
    """Only the invalid tool call names are corrected; valid ones are unchanged."""
    mw = SanitizeToolNamesMiddleware()
    ai_msg = AIMessage(
        content="",
        tool_calls=[
            {"name": "valid_tool", "args": {}, "id": "tc1"},
            {"name": 'bad_tool" />\n</invoke>', "args": {}, "id": "tc2"},
        ],
    )
    state = _make_state(ai_msg)
    result = mw.before_agent(state)

    assert result is not None
    patched = result["messages"].value
    ai_patched = next(m for m in patched if isinstance(m, AIMessage))
    names = [tc["name"] for tc in ai_patched.tool_calls]
    assert names == ["valid_tool", "bad_tool"]
