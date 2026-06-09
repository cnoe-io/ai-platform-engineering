"""Regression tests for stream encoder memory-update detection."""

from dynamic_agents.services.stream_encoders.agui_sse import (
    _memory_update_payload as agui_memory_update_payload,
)
from dynamic_agents.services.stream_encoders.custom_sse import (
    _memory_update_payload as custom_memory_update_payload,
)


def test_memory_update_payload_ignores_json_list_tool_results():
    """Tool results such as glob can be JSON lists, not memory event dicts."""
    for parse_memory_update in (agui_memory_update_payload, custom_memory_update_payload):
        assert parse_memory_update('["/uploads/example.vtt"]', ("agent",)) is None


def test_memory_update_payload_parses_memory_event_dicts():
    content = '{"memory_event":"updated","memory_ids":["mem-1"],"action":"create"}'

    for parse_memory_update in (agui_memory_update_payload, custom_memory_update_payload):
        assert parse_memory_update(content, ("agent", "subagent")) == {
            "memory_ids": ["mem-1"],
            "action": "create",
            "namespace": ["agent", "subagent"],
        }
