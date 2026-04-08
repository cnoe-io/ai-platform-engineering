# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Unit tests for TurnPersistence and normalize_a2a_event.

All tests use an in-process MongoMock so no live MongoDB is required.
"""

from __future__ import annotations

import time

import mongomock

from ai_platform_engineering.utils.persistence.turn_persistence import (
    TurnPersistence,
    normalize_a2a_event,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_persistence() -> tuple[TurnPersistence, "mongomock.MongoClient"]:
    """Return a TurnPersistence wired to an in-memory mongomock client."""
    mock_client = mongomock.MongoClient()
    persistence = TurnPersistence.__new__(TurnPersistence)
    # Bypass real __init__ so we can inject the mock client
    persistence._client = mock_client
    persistence._db_name = "test_db"
    persistence._content_buffer_size = 10
    persistence._content_flush_interval_s = 2.0
    persistence._content_buffers = {}
    persistence._event_sequences = {}
    return persistence, mock_client


# ---------------------------------------------------------------------------
# normalize_a2a_event
# ---------------------------------------------------------------------------

class TestNormalizeA2AEvent:
    """Tests for the standalone normalize_a2a_event helper."""

    def test_tool_notification_start_via_artifact(self):
        event = {"artifact": {"name": "tool_notification_start", "text": "🔧 Calling Jira"}}
        result = normalize_a2a_event(event)
        assert result["type"] == "tool_start"
        assert "🔧 Calling Jira" in result["data"]["content"]

    def test_tool_notification_start_via_tool_call(self):
        event = {"tool_call": {"name": "search_jira", "id": "tc-1", "arguments": {"q": "bug"}}}
        result = normalize_a2a_event(event)
        assert result["type"] == "tool_start"
        assert result["data"]["tool_name"] == "search_jira"
        assert result["data"]["tool_call_id"] == "tc-1"

    def test_tool_notification_end_via_artifact(self):
        event = {"artifact": {"name": "tool_notification_end", "text": "✅ Jira completed"}}
        result = normalize_a2a_event(event)
        assert result["type"] == "tool_end"

    def test_tool_notification_end_via_tool_result(self):
        event = {"tool_result": {"name": "search_jira", "id": "tc-1", "output": "5 tickets"}}
        result = normalize_a2a_event(event)
        assert result["type"] == "tool_end"
        assert result["data"]["tool_name"] == "search_jira"
        assert result["data"]["output"] == "5 tickets"

    def test_execution_plan_update(self):
        event = {"artifact": {"name": "execution_plan_update", "text": "⏳ [Jira] Search"}}
        result = normalize_a2a_event(event)
        assert result["type"] == "plan_update"
        assert "⏳" in result["data"]["plan_text"]

    def test_execution_plan_status_update(self):
        event = {"artifact": {"name": "execution_plan_status_update", "text": "✅ [Jira] Done"}}
        result = normalize_a2a_event(event)
        assert result["type"] == "plan_update"

    def test_streaming_result(self):
        event = {"artifact": {"name": "streaming_result", "text": "Hello world"}}
        result = normalize_a2a_event(event)
        assert result["type"] == "content"
        assert result["data"]["is_final"] is False

    def test_final_result(self):
        event = {"artifact": {"name": "final_result", "text": "Done!"}}
        result = normalize_a2a_event(event)
        assert result["type"] == "content"
        assert result["data"]["is_final"] is True

    def test_raw_content_chunk(self):
        event = {"content": "some text", "is_task_complete": False}
        result = normalize_a2a_event(event)
        assert result["type"] == "content"
        assert result["data"]["content"] == "some text"

    def test_subagent_end(self):
        event = {
            "type": "artifact-update",
            "source_agent": "JiraAgent",
            "result": {
                "artifact": {
                    "name": "final_result",
                    "parts": [{"text": "Jira output"}],
                }
            },
        }
        result = normalize_a2a_event(event)
        assert result["type"] == "subagent_end"
        assert result["namespace"] == ["JiraAgent"]

    def test_input_required(self):
        event = {"require_user_input": True, "content": "Please provide repo name"}
        result = normalize_a2a_event(event)
        assert result["type"] == "input_required"
        assert result["data"]["content"] == "Please provide repo name"

    def test_namespace_from_source_agent(self):
        event = {"source_agent": "GitHubAgent", "content": "streaming..."}
        result = normalize_a2a_event(event)
        assert result["namespace"] == ["GitHubAgent"]

    def test_no_source_agent_empty_namespace(self):
        event = {"content": "no agent"}
        result = normalize_a2a_event(event)
        assert result["namespace"] == []


# ---------------------------------------------------------------------------
# TurnPersistence
# ---------------------------------------------------------------------------

class TestTurnPersistence:
    """Tests for TurnPersistence service methods."""

    def test_create_turn_returns_uuid(self):
        p, _ = _make_persistence()
        turn_id = p.create_turn(
            conversation_id="conv-1",
            user_message={"content": "hello"},
        )
        assert isinstance(turn_id, str)
        assert len(turn_id) == 36  # UUID format

    def test_create_turn_inserts_document(self):
        p, client = _make_persistence()
        turn_id = p.create_turn(
            conversation_id="conv-1",
            user_message={"content": "hello", "sender_email": "user@example.com"},
            metadata={"source": "slack", "trace_id": "trace-abc"},
        )
        doc = client["test_db"]["turns"].find_one({"_id": turn_id})
        assert doc is not None
        assert doc["conversation_id"] == "conv-1"
        assert doc["user_message"]["content"] == "hello"
        assert doc["user_message"]["sender_email"] == "user@example.com"
        assert doc["assistant_message"]["status"] == "streaming"
        assert doc["metadata"]["source"] == "slack"
        assert doc["metadata"]["trace_id"] == "trace-abc"

    def test_create_turn_sequence_increments(self):
        p, client = _make_persistence()
        id1 = p.create_turn(conversation_id="conv-seq", user_message={"content": "a"})
        id2 = p.create_turn(conversation_id="conv-seq", user_message={"content": "b"})
        doc1 = client["test_db"]["turns"].find_one({"_id": id1})
        doc2 = client["test_db"]["turns"].find_one({"_id": id2})
        assert doc1["sequence"] == 0
        assert doc2["sequence"] == 1

    def test_create_turn_no_mongodb_returns_uuid(self):
        """When MongoDB is None, create_turn still returns a UUID string."""
        p, _ = _make_persistence()
        p._client = None
        turn_id = p.create_turn(conversation_id="conv-x", user_message={"content": "hi"})
        assert isinstance(turn_id, str)

    def test_append_event_inserts_document(self):
        p, client = _make_persistence()
        turn_id = p.create_turn("conv-2", {"content": "test"})
        p.append_event(
            turn_id=turn_id,
            event_type="tool_start",
            data={"tool_name": "jira_search"},
            namespace=["JiraAgent"],
            conversation_id="conv-2",
        )
        events = list(client["test_db"]["stream_events"].find({"turn_id": turn_id}))
        assert len(events) == 1
        assert events[0]["type"] == "tool_start"
        assert events[0]["data"]["tool_name"] == "jira_search"
        assert events[0]["namespace"] == ["JiraAgent"]
        assert events[0]["conversation_id"] == "conv-2"

    def test_append_event_sequence_increments(self):
        p, client = _make_persistence()
        turn_id = p.create_turn("conv-3", {"content": "test"})
        for _ in range(3):
            p.append_event(turn_id=turn_id, event_type="content", data={}, conversation_id="conv-3")
        events = list(client["test_db"]["stream_events"].find({"turn_id": turn_id}).sort("sequence", 1))
        assert [e["sequence"] for e in events] == [0, 1, 2]

    def test_append_event_no_mongodb_noop(self):
        """append_event is a no-op when MongoDB is unavailable."""
        p, _ = _make_persistence()
        p._client = None
        turn_id = "fake-turn-id"
        # Should not raise
        p.append_event(turn_id=turn_id, event_type="content", data={"content": "x"})

    def test_append_content_buffers_and_flushes(self):
        p, client = _make_persistence()
        p._content_buffer_size = 3  # Flush every 3 chunks
        turn_id = p.create_turn("conv-4", {"content": "q"})

        p.append_content(turn_id, "Hello")
        p.append_content(turn_id, " World")
        # Not yet flushed (buffer_size=3, only 2 chunks)
        doc = client["test_db"]["turns"].find_one({"_id": turn_id})
        assert doc["assistant_message"]["content"] == ""  # not flushed yet

        p.append_content(turn_id, "!")  # 3rd chunk → flush
        doc = client["test_db"]["turns"].find_one({"_id": turn_id})
        assert doc["assistant_message"]["content"] == "Hello World!"

    def test_append_content_time_flush(self):
        """Content should flush when flush interval elapsed."""
        p, client = _make_persistence()
        p._content_flush_interval_s = 0.0  # Always flush immediately
        turn_id = p.create_turn("conv-5", {"content": "q"})
        p.append_content(turn_id, "streamed chunk")
        doc = client["test_db"]["turns"].find_one({"_id": turn_id})
        assert doc["assistant_message"]["content"] == "streamed chunk"

    def test_complete_turn_sets_status_and_content(self):
        p, client = _make_persistence()
        turn_id = p.create_turn("conv-6", {"content": "q"})
        p.complete_turn(turn_id, "Final answer here", status="completed")
        doc = client["test_db"]["turns"].find_one({"_id": turn_id})
        assert doc["assistant_message"]["content"] == "Final answer here"
        assert doc["assistant_message"]["status"] == "completed"
        assert doc["assistant_message"]["completed_at"] is not None

    def test_complete_turn_failed_status(self):
        p, client = _make_persistence()
        turn_id = p.create_turn("conv-7", {"content": "q"})
        p.complete_turn(turn_id, "", status="failed")
        doc = client["test_db"]["turns"].find_one({"_id": turn_id})
        assert doc["assistant_message"]["status"] == "failed"

    def test_complete_turn_waiting_for_input(self):
        p, client = _make_persistence()
        turn_id = p.create_turn("conv-8", {"content": "q"})
        p.complete_turn(turn_id, "Please enter name", status="waiting_for_input")
        doc = client["test_db"]["turns"].find_one({"_id": turn_id})
        assert doc["assistant_message"]["status"] == "waiting_for_input"

    def test_complete_turn_clears_buffer(self):
        p, _ = _make_persistence()
        turn_id = p.create_turn("conv-9", {"content": "q"})
        p._content_buffers[turn_id] = (["chunk1"], time.monotonic(), 0)
        p.complete_turn(turn_id, "done")
        # Buffer should be cleared
        assert turn_id not in p._content_buffers

    def test_get_turns_returns_ordered(self):
        p, _ = _make_persistence()
        p.create_turn("conv-A", {"content": "first"})
        p.create_turn("conv-A", {"content": "second"})
        p.create_turn("conv-A", {"content": "third"})
        turns = p.get_turns("conv-A")
        assert len(turns) == 3
        assert [t["sequence"] for t in turns] == [0, 1, 2]

    def test_get_turns_empty_when_no_data(self):
        p, _ = _make_persistence()
        turns = p.get_turns("conv-nonexistent")
        assert turns == []

    def test_get_turns_no_mongodb_returns_empty(self):
        p, _ = _make_persistence()
        p._client = None
        assert p.get_turns("conv-X") == []

    def test_get_turn_events_returns_ordered(self):
        p, _ = _make_persistence()
        turn_id = p.create_turn("conv-B", {"content": "q"})
        p.append_event(turn_id, "tool_start", {"tool_name": "a"}, conversation_id="conv-B")
        p.append_event(turn_id, "tool_end", {"tool_name": "a"}, conversation_id="conv-B")
        p.append_event(turn_id, "content", {"content": "result"}, conversation_id="conv-B")
        events = p.get_turn_events(turn_id)
        assert len(events) == 3
        assert events[0]["type"] == "tool_start"
        assert events[1]["type"] == "tool_end"
        assert events[2]["type"] == "content"

    def test_get_turn_events_no_mongodb_returns_empty(self):
        p, _ = _make_persistence()
        p._client = None
        assert p.get_turn_events("turn-X") == []

    def test_get_conversation_events_returns_all(self):
        p, _ = _make_persistence()
        t1 = p.create_turn("conv-C", {"content": "first"})
        t2 = p.create_turn("conv-C", {"content": "second"})
        p.append_event(t1, "tool_start", {}, conversation_id="conv-C")
        p.append_event(t2, "tool_start", {}, conversation_id="conv-C")
        events = p.get_conversation_events("conv-C")
        assert len(events) == 2

    def test_get_conversation_events_no_mongodb_returns_empty(self):
        p, _ = _make_persistence()
        p._client = None
        assert p.get_conversation_events("conv-Y") == []

    def test_complete_turn_also_persists_final_event(self):
        p, client = _make_persistence()
        turn_id = p.create_turn("conv-D", {"content": "q"})
        p.complete_turn(turn_id, "All done", status="completed")
        # complete_turn calls append_event for the final content event
        events = list(client["test_db"]["stream_events"].find({"turn_id": turn_id}))
        assert any(e["type"] == "content" and e["data"].get("is_final") for e in events)

    def test_multiple_turns_isolated_event_sequences(self):
        p, _ = _make_persistence()
        t1 = p.create_turn("conv-E", {"content": "q1"})
        t2 = p.create_turn("conv-E", {"content": "q2"})
        p.append_event(t1, "content", {}, conversation_id="conv-E")
        p.append_event(t2, "content", {}, conversation_id="conv-E")
        p.append_event(t1, "content", {}, conversation_id="conv-E")
        e1 = p.get_turn_events(t1)
        e2 = p.get_turn_events(t2)
        # Each turn has its own sequence starting at 0
        assert e1[0]["sequence"] == 0
        assert e1[1]["sequence"] == 1
        assert e2[0]["sequence"] == 0
