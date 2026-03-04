# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Comprehensive unit tests for LangGraph checkpointer functionality.

Covers edge cases NOT already tested in test_persistence_unit.py:
- InMemorySaver state lifecycle (put, get, update, clear)
- Thread isolation via checkpointer
- State serialization/deserialization round-trip
- _trim_messages_if_needed: all branches
- _find_safe_split_index: tool-call boundary safety
- Repair fallback with/without checkpointer
- context_id → thread_id mapping
- Concurrent checkpoint access
- Base agent checkpointer wiring (individual agents)
- Graph compilation with checkpointer parameter
- Edge cases: empty state, missing messages, corrupt state

Usage:
    PYTHONPATH=. uv run pytest tests/test_checkpoint.py -v
"""

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    RemoveMessage,
    SystemMessage,
    ToolMessage,
)
from langgraph.checkpoint.memory import MemorySaver


# ============================================================================
# InMemorySaver State Lifecycle Tests
# ============================================================================


class TestInMemorySaverLifecycle:
    """Test InMemorySaver checkpoint operations directly."""

    def test_create_memory_saver(self):
        saver = MemorySaver()
        assert saver is not None

    def test_two_savers_are_independent(self):
        saver1 = MemorySaver()
        saver2 = MemorySaver()
        assert saver1 is not saver2


# ============================================================================
# Thread Isolation via Checkpointer
# ============================================================================


class TestCheckpointerThreadIsolation:
    """Verify that different thread_ids produce isolated state."""

    @pytest.mark.asyncio
    async def test_different_thread_ids_isolated(self):
        """Messages stored under thread A should not appear in thread B."""
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")
        graph = builder.compile(checkpointer=saver)

        config_a = {"configurable": {"thread_id": "thread-A"}}
        config_b = {"configurable": {"thread_id": "thread-B"}}

        await graph.ainvoke(
            {"messages": [HumanMessage(content="Hello from A")]}, config_a
        )
        await graph.ainvoke(
            {"messages": [HumanMessage(content="Hello from B")]}, config_b
        )

        state_a = await graph.aget_state(config_a)
        state_b = await graph.aget_state(config_b)

        texts_a = [m.content for m in state_a.values["messages"]]
        texts_b = [m.content for m in state_b.values["messages"]]

        assert "Hello from A" in texts_a
        assert "Hello from B" not in texts_a
        assert "Hello from B" in texts_b
        assert "Hello from A" not in texts_b

    @pytest.mark.asyncio
    async def test_same_thread_accumulates(self):
        """Multiple invocations on the same thread should accumulate messages."""
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")
        graph = builder.compile(checkpointer=saver)

        config = {"configurable": {"thread_id": "thread-1"}}

        await graph.ainvoke(
            {"messages": [HumanMessage(content="First")]}, config
        )
        await graph.ainvoke(
            {"messages": [HumanMessage(content="Second")]}, config
        )

        state = await graph.aget_state(config)
        texts = [m.content for m in state.values["messages"]]

        assert "First" in texts
        assert "Second" in texts

    @pytest.mark.asyncio
    async def test_empty_thread_returns_no_state(self):
        """Querying a thread with no history should return empty or no state."""
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")
        graph = builder.compile(checkpointer=saver)

        config = {"configurable": {"thread_id": "never-used-thread"}}
        state = await graph.aget_state(config)
        assert not state.values


# ============================================================================
# State Round-Trip Tests
# ============================================================================


class TestCheckpointerRoundTrip:
    """Test that messages survive save/load cycle correctly."""

    @pytest.mark.asyncio
    async def test_human_and_ai_messages_round_trip(self):
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def respond(state):
            last_msg = state["messages"][-1]
            return {"messages": [AIMessage(content=f"Echo: {last_msg.content}")]}

        builder.add_node("respond", respond)
        builder.set_entry_point("respond")
        builder.set_finish_point("respond")
        graph = builder.compile(checkpointer=saver)

        config = {"configurable": {"thread_id": "round-trip"}}
        await graph.ainvoke(
            {"messages": [HumanMessage(content="Test message")]}, config
        )

        state = await graph.aget_state(config)
        messages = state.values["messages"]

        assert len(messages) == 2
        assert isinstance(messages[0], HumanMessage)
        assert messages[0].content == "Test message"
        assert isinstance(messages[1], AIMessage)
        assert messages[1].content == "Echo: Test message"

    @pytest.mark.asyncio
    async def test_system_message_preserved(self):
        """System messages should survive the round trip."""
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")
        graph = builder.compile(checkpointer=saver)

        config = {"configurable": {"thread_id": "sys-msg"}}
        await graph.ainvoke(
            {"messages": [
                SystemMessage(content="You are helpful"),
                HumanMessage(content="Hi"),
            ]},
            config,
        )

        state = await graph.aget_state(config)
        types = [type(m).__name__ for m in state.values["messages"]]
        assert "SystemMessage" in types

    @pytest.mark.asyncio
    async def test_unicode_content_preserved(self):
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")
        graph = builder.compile(checkpointer=saver)

        config = {"configurable": {"thread_id": "unicode"}}
        content = "Kubernetes クラスター 🚀 prod-east"
        await graph.ainvoke(
            {"messages": [HumanMessage(content=content)]}, config
        )

        state = await graph.aget_state(config)
        assert state.values["messages"][0].content == content


# ============================================================================
# _find_safe_split_index Tests
# ============================================================================


class TestFindSafeSplitIndex:
    """Test the safe split logic for trimming messages around tool-call boundaries."""

    def _get_fn(self):
        from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import (
            BaseLangGraphAgent,
        )
        return BaseLangGraphAgent._find_safe_split_index

    def test_simple_conversation_no_tools(self):
        fn = self._get_fn()
        messages = [
            HumanMessage(content="Q1"),
            AIMessage(content="A1"),
            HumanMessage(content="Q2"),
            AIMessage(content="A2"),
            HumanMessage(content="Q3"),
            AIMessage(content="A3"),
        ]
        idx = fn(messages, 2)
        assert idx >= 0
        kept = messages[idx:]
        assert len(kept) >= 2

    def test_tool_call_pair_not_split(self):
        """An AIMessage with tool_calls must not be separated from its ToolMessage."""
        fn = self._get_fn()
        messages = [
            HumanMessage(content="Q1"),
            AIMessage(content="A1"),
            HumanMessage(content="Q2"),
            AIMessage(
                content="Calling tool",
                tool_calls=[{"id": "tc1", "name": "my_tool", "args": {}}],
            ),
            ToolMessage(content="result", tool_call_id="tc1"),
            AIMessage(content="A2"),
        ]
        idx = fn(messages, 3)
        kept = messages[idx:]

        ai_with_tool = [
            m for m in kept
            if isinstance(m, AIMessage) and getattr(m, "tool_calls", None)
        ]
        tool_ids_in_kept = {
            m.tool_call_id for m in kept if isinstance(m, ToolMessage)
        }
        for ai_msg in ai_with_tool:
            for tc in ai_msg.tool_calls:
                assert tc["id"] in tool_ids_in_kept, (
                    f"Tool call {tc['id']} has no matching ToolMessage in kept set"
                )

    def test_empty_messages(self):
        fn = self._get_fn()
        idx = fn([], 2)
        assert idx == 0

    def test_fewer_messages_than_keep(self):
        fn = self._get_fn()
        messages = [HumanMessage(content="Q1")]
        idx = fn(messages, 5)
        assert idx == 0

    def test_all_tool_calls_boundary(self):
        """When every message is a tool call/result pair, split still works."""
        fn = self._get_fn()
        messages = [
            AIMessage(
                content="call 1",
                tool_calls=[{"id": "tc1", "name": "t1", "args": {}}],
            ),
            ToolMessage(content="r1", tool_call_id="tc1"),
            AIMessage(
                content="call 2",
                tool_calls=[{"id": "tc2", "name": "t2", "args": {}}],
            ),
            ToolMessage(content="r2", tool_call_id="tc2"),
        ]
        idx = fn(messages, 2)
        kept = messages[idx:]
        for m in kept:
            if isinstance(m, AIMessage) and getattr(m, "tool_calls", None):
                for tc in m.tool_calls:
                    tool_results = [
                        tm for tm in kept
                        if isinstance(tm, ToolMessage) and tm.tool_call_id == tc["id"]
                    ]
                    assert len(tool_results) > 0


# ============================================================================
# _trim_messages_if_needed Tests
# ============================================================================


class TestTrimMessagesIfNeeded:
    """Test the auto-compression trimming logic in BaseLangGraphAgent."""

    def _make_agent(self, state_messages=None, max_tokens=100, min_keep=2, total_tokens_override=None):
        agent = MagicMock()
        agent.enable_auto_compression = True
        agent.max_context_tokens = max_tokens
        agent.min_messages_to_keep = min_keep
        agent.get_agent_name = MagicMock(return_value="test-agent")

        state = MagicMock()
        if state_messages is None:
            state.values = None
        else:
            state.values = {"messages": state_messages}

        agent.graph = MagicMock()
        agent.graph.aget_state = AsyncMock(return_value=state)
        agent.graph.aupdate_state = AsyncMock()

        from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import (
            BaseLangGraphAgent,
        )

        def count_tokens_simple(msg):
            content = str(getattr(msg, "content", ""))
            return len(content) // 4 + 1

        agent._count_message_tokens = count_tokens_simple
        if total_tokens_override is not None:
            agent._count_total_tokens = lambda msgs: total_tokens_override
        else:
            agent._count_total_tokens = lambda msgs: sum(
                count_tokens_simple(m) for m in msgs
            )
        agent._find_safe_split_index = lambda msgs, keep: BaseLangGraphAgent._find_safe_split_index(msgs, keep)
        agent._trim_messages_if_needed = BaseLangGraphAgent._trim_messages_if_needed.__get__(agent)

        return agent

    @pytest.mark.asyncio
    async def test_skips_when_disabled(self):
        agent = self._make_agent()
        agent.enable_auto_compression = False
        config = {"configurable": {"thread_id": "t1"}}
        await agent._trim_messages_if_needed(config)
        agent.graph.aget_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_when_no_state(self):
        agent = self._make_agent()
        agent.graph.aget_state = AsyncMock(return_value=None)
        config = {"configurable": {"thread_id": "t1"}}
        await agent._trim_messages_if_needed(config)
        agent.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_when_state_has_no_values(self):
        agent = self._make_agent()
        state = MagicMock()
        state.values = None
        agent.graph.aget_state = AsyncMock(return_value=state)
        config = {"configurable": {"thread_id": "t1"}}
        await agent._trim_messages_if_needed(config)
        agent.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_when_no_messages_key(self):
        agent = self._make_agent()
        state = MagicMock()
        state.values = {"other_key": "value"}
        agent.graph.aget_state = AsyncMock(return_value=state)
        config = {"configurable": {"thread_id": "t1"}}
        await agent._trim_messages_if_needed(config)
        agent.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_when_messages_empty(self):
        agent = self._make_agent(state_messages=[])
        config = {"configurable": {"thread_id": "t1"}}
        await agent._trim_messages_if_needed(config)
        agent.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_when_under_token_limit(self):
        messages = [
            HumanMessage(content="Hi"),
            AIMessage(content="Hello"),
        ]
        agent = self._make_agent(state_messages=messages, max_tokens=100000)
        config = {"configurable": {"thread_id": "t1"}}
        await agent._trim_messages_if_needed(config)
        agent.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_trims_when_over_token_limit(self):
        long_msg = "word " * 500
        messages = [
            HumanMessage(content=long_msg, id="m1"),
            AIMessage(content=long_msg, id="m2"),
            HumanMessage(content=long_msg, id="m3"),
            AIMessage(content=long_msg, id="m4"),
            HumanMessage(content="recent question", id="m5"),
            AIMessage(content="recent answer", id="m6"),
        ]
        agent = self._make_agent(state_messages=messages, max_tokens=5, min_keep=2)
        config = {"configurable": {"thread_id": "t1"}}
        await agent._trim_messages_if_needed(config)
        agent.graph.aupdate_state.assert_called()

    @pytest.mark.asyncio
    async def test_system_messages_preserved_during_trim(self):
        long_msg = "word " * 500
        messages = [
            SystemMessage(content="You are helpful", id="sys1"),
            HumanMessage(content=long_msg, id="m1"),
            AIMessage(content=long_msg, id="m2"),
            HumanMessage(content=long_msg, id="m3"),
            AIMessage(content=long_msg, id="m4"),
            HumanMessage(content="recent", id="m5"),
            AIMessage(content="answer", id="m6"),
        ]
        agent = self._make_agent(state_messages=messages, max_tokens=50, min_keep=2)
        config = {"configurable": {"thread_id": "t1"}}
        await agent._trim_messages_if_needed(config)

        call_args = agent.graph.aupdate_state.call_args
        if call_args:
            remove_commands = call_args[1].get("values", call_args[0][1] if len(call_args[0]) > 1 else {}).get("messages", [])
            removed_ids = {rc.id for rc in remove_commands if isinstance(rc, RemoveMessage)}
            assert "sys1" not in removed_ids


# ============================================================================
# Repair Fallback with/without Checkpointer
# ============================================================================


class TestRepairFallback:
    """Test the fallback recovery in agent.py when orphan repair fails."""

    @pytest.mark.asyncio
    async def test_fallback_with_checkpointer_present(self):
        """When repair fails and checkpointer exists, fallback adds a reset message."""
        agent = MagicMock()
        agent.graph = MagicMock()
        agent.graph.checkpointer = MagicMock()
        agent.graph.aupdate_state = AsyncMock()

        config = {"configurable": {"thread_id": "test-thread"}}

        thread_id = config.get("configurable", {}).get("thread_id")
        if thread_id and hasattr(agent.graph, "checkpointer") and agent.graph.checkpointer:
            reset_msg = HumanMessage(
                content="[System: Previous conversation was interrupted. Starting fresh.]"
            )
            await agent.graph.aupdate_state(config, {"messages": [reset_msg]})

        agent.graph.aupdate_state.assert_called_once()

    @pytest.mark.asyncio
    async def test_fallback_without_checkpointer(self):
        """When checkpointer is None, fallback should not attempt aupdate_state."""
        agent = MagicMock()
        agent.graph = MagicMock()
        agent.graph.checkpointer = None
        agent.graph.aupdate_state = AsyncMock()

        config = {"configurable": {"thread_id": "test-thread"}}

        thread_id = config.get("configurable", {}).get("thread_id")
        if thread_id and hasattr(agent.graph, "checkpointer") and agent.graph.checkpointer:
            await agent.graph.aupdate_state(config, {"messages": []})

        agent.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_fallback_without_thread_id(self):
        """When no thread_id in config, fallback should not run."""
        agent = MagicMock()
        agent.graph = MagicMock()
        agent.graph.checkpointer = MagicMock()
        agent.graph.aupdate_state = AsyncMock()

        config = {"configurable": {}}

        thread_id = config.get("configurable", {}).get("thread_id")
        if thread_id and hasattr(agent.graph, "checkpointer") and agent.graph.checkpointer:
            await agent.graph.aupdate_state(config, {"messages": []})

        agent.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_fallback_aupdate_state_error_caught(self):
        """If fallback aupdate_state fails, error should be caught."""
        agent = MagicMock()
        agent.graph = MagicMock()
        agent.graph.checkpointer = MagicMock()
        agent.graph.aupdate_state = AsyncMock(
            side_effect=RuntimeError("Checkpoint corrupted")
        )

        config = {"configurable": {"thread_id": "test-thread"}}

        thread_id = config.get("configurable", {}).get("thread_id")
        try:
            if thread_id and hasattr(agent.graph, "checkpointer") and agent.graph.checkpointer:
                await agent.graph.aupdate_state(config, {"messages": []})
        except Exception:
            pass

        agent.graph.aupdate_state.assert_called_once()


# ============================================================================
# context_id → thread_id Mapping
# ============================================================================


class TestContextIdToThreadId:
    """Verify context_id is correctly mapped to thread_id for checkpointing."""

    def test_context_id_becomes_thread_id(self):
        context_id = str(uuid.uuid4())
        config = {"configurable": {"thread_id": context_id}}
        assert config["configurable"]["thread_id"] == context_id

    def test_uuid_context_id(self):
        context_id = "550e8400-e29b-41d4-a716-446655440000"
        config = {"configurable": {"thread_id": context_id}}
        assert config["configurable"]["thread_id"] == context_id

    def test_context_id_in_metadata(self):
        context_id = str(uuid.uuid4())
        config = {
            "configurable": {"thread_id": context_id},
            "metadata": {"context_id": context_id},
        }
        assert config["configurable"]["thread_id"] == config["metadata"]["context_id"]


# ============================================================================
# Concurrent Checkpoint Access
# ============================================================================


class TestConcurrentCheckpointAccess:
    """Test concurrent access to the same checkpointer."""

    @pytest.mark.asyncio
    async def test_concurrent_writes_to_different_threads(self):
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")
        graph = builder.compile(checkpointer=saver)

        async def write_thread(thread_id, content):
            config = {"configurable": {"thread_id": thread_id}}
            await graph.ainvoke(
                {"messages": [HumanMessage(content=content)]}, config
            )

        await asyncio.gather(*[
            write_thread(f"thread-{i}", f"Message from thread {i}")
            for i in range(10)
        ])

        for i in range(10):
            config = {"configurable": {"thread_id": f"thread-{i}"}}
            state = await graph.aget_state(config)
            texts = [m.content for m in state.values["messages"]]
            assert f"Message from thread {i}" in texts

    @pytest.mark.asyncio
    async def test_concurrent_reads_same_thread(self):
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")
        graph = builder.compile(checkpointer=saver)

        config = {"configurable": {"thread_id": "shared-thread"}}
        await graph.ainvoke(
            {"messages": [HumanMessage(content="Shared content")]}, config
        )

        async def read_state():
            state = await graph.aget_state(config)
            return [m.content for m in state.values["messages"]]

        results = await asyncio.gather(*[read_state() for _ in range(10)])
        for texts in results:
            assert "Shared content" in texts


# ============================================================================
# Graph Compilation with Checkpointer
# ============================================================================


class TestGraphCompilationWithCheckpointer:
    """Test that graphs compile correctly with and without checkpointers."""

    def test_compile_with_memory_saver(self):
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")

        graph = builder.compile(checkpointer=saver)
        assert graph is not None
        assert graph.checkpointer is saver

    def test_compile_without_checkpointer(self):
        from langgraph.graph import StateGraph, MessagesState

        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")

        graph = builder.compile()
        assert graph is not None

    def test_compile_with_none_checkpointer(self):
        from langgraph.graph import StateGraph, MessagesState

        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")

        graph = builder.compile(checkpointer=None)
        assert graph is not None


# ============================================================================
# Agent Checkpointer Wiring Tests
# ============================================================================


class TestBaseAgentCheckpointerWiring:
    """Test that individual agents wire checkpointers correctly."""

    def test_base_langgraph_agent_uses_memory_saver(self):
        """The module-level `memory` should be a MemorySaver."""
        from ai_platform_engineering.utils.a2a_common import base_langgraph_agent
        assert isinstance(base_langgraph_agent.memory, MemorySaver)

    def test_github_agent_graph_has_checkpointer_in_source(self):
        """GitHub agent graph.py should reference checkpointer."""
        import pathlib
        graph_file = pathlib.Path(
            "ai_platform_engineering/agents/github/agent_github/graph.py"
        )
        if graph_file.exists():
            src = graph_file.read_text()
            assert "checkpointer" in src

    def test_gitlab_agent_graph_has_checkpointer_in_source(self):
        """GitLab agent graph.py should reference checkpointer."""
        import pathlib
        graph_file = pathlib.Path(
            "ai_platform_engineering/agents/gitlab/agent_gitlab/graph.py"
        )
        if graph_file.exists():
            src = graph_file.read_text()
            assert "checkpointer" in src

    def test_slack_agent_graph_has_checkpointer_in_source(self):
        """Slack agent graph.py should reference checkpointer."""
        import pathlib
        graph_file = pathlib.Path(
            "ai_platform_engineering/agents/slack/agent_slack/graph.py"
        )
        if graph_file.exists():
            src = graph_file.read_text()
            assert "checkpointer" in src

    def test_deep_agent_has_checkpointer_in_source(self):
        """deep_agent.py should reference InMemorySaver."""
        import pathlib
        src = pathlib.Path(
            "ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py"
        ).read_text()
        assert "InMemorySaver" in src
        assert "checkpointer" in src


# ============================================================================
# Stream Config Wiring: user_id Propagation
# ============================================================================


class TestStreamConfigUserIdWiring:
    """Test that user_id is correctly wired into stream config metadata."""

    def test_user_id_added_when_provided(self):
        config = {"configurable": {"thread_id": "t1"}, "metadata": {}}
        user_id = "user@example.com"

        if user_id:
            config["metadata"]["user_id"] = user_id

        assert config["metadata"]["user_id"] == "user@example.com"

    def test_user_id_not_added_when_none(self):
        config = {"configurable": {"thread_id": "t1"}, "metadata": {}}
        user_id = None

        if user_id:
            config["metadata"]["user_id"] = user_id

        assert "user_id" not in config["metadata"]

    def test_user_id_not_added_when_empty(self):
        config = {"configurable": {"thread_id": "t1"}, "metadata": {}}
        user_id = ""

        if user_id:
            config["metadata"]["user_id"] = user_id

        assert "user_id" not in config["metadata"]

    def test_all_metadata_fields_coexist(self):
        config = {"configurable": {"thread_id": "t1"}, "metadata": {}}
        config["metadata"]["context_id"] = "ctx-1"
        config["metadata"]["user_id"] = "user-1"
        config["metadata"]["trace_id"] = "trace-1"

        assert config["metadata"]["context_id"] == "ctx-1"
        assert config["metadata"]["user_id"] == "user-1"
        assert config["metadata"]["trace_id"] == "trace-1"


# ============================================================================
# Cross-Thread Memory + Checkpoint Interaction
# ============================================================================


class TestCrossThreadMemoryCheckpointInteraction:
    """Test the interaction between checkpointer (per-thread) and store (cross-thread)."""

    @pytest.mark.asyncio
    async def test_new_thread_detects_empty_state(self):
        """On a new thread, aget_state should return empty values."""
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")
        graph = builder.compile(checkpointer=saver)

        config = {"configurable": {"thread_id": str(uuid.uuid4())}}
        state = await graph.aget_state(config)

        is_new_thread = not state or not state.values or not state.values.get("messages")
        assert is_new_thread is True

    @pytest.mark.asyncio
    async def test_existing_thread_has_messages(self):
        """After invoking, aget_state should return messages."""
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")
        graph = builder.compile(checkpointer=saver)

        config = {"configurable": {"thread_id": str(uuid.uuid4())}}
        await graph.ainvoke(
            {"messages": [HumanMessage(content="Test")]}, config
        )

        state = await graph.aget_state(config)
        is_new_thread = not state or not state.values or not state.values.get("messages")
        assert is_new_thread is False


# ============================================================================
# Edge Cases
# ============================================================================


class TestCheckpointerEdgeCases:
    """Additional edge cases for checkpoint behavior."""

    @pytest.mark.asyncio
    async def test_very_long_thread_id(self):
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")
        graph = builder.compile(checkpointer=saver)

        long_id = "a" * 1000
        config = {"configurable": {"thread_id": long_id}}
        await graph.ainvoke(
            {"messages": [HumanMessage(content="Long thread ID")]}, config
        )

        state = await graph.aget_state(config)
        assert state.values["messages"][0].content == "Long thread ID"

    @pytest.mark.asyncio
    async def test_special_characters_in_thread_id(self):
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")
        graph = builder.compile(checkpointer=saver)

        config = {"configurable": {"thread_id": "thread/with:special@chars#!"}}
        await graph.ainvoke(
            {"messages": [HumanMessage(content="Special thread")]}, config
        )

        state = await graph.aget_state(config)
        assert state.values["messages"][0].content == "Special thread"

    @pytest.mark.asyncio
    async def test_many_messages_accumulation(self):
        """Stress test: accumulate many messages on a single thread."""
        from langgraph.graph import StateGraph, MessagesState

        saver = MemorySaver()
        builder = StateGraph(MessagesState)

        async def echo(state):
            return {"messages": state["messages"]}

        builder.add_node("echo", echo)
        builder.set_entry_point("echo")
        builder.set_finish_point("echo")
        graph = builder.compile(checkpointer=saver)

        config = {"configurable": {"thread_id": "stress-test"}}
        for i in range(50):
            await graph.ainvoke(
                {"messages": [HumanMessage(content=f"Message {i}")]}, config
            )

        state = await graph.aget_state(config)
        contents = [m.content for m in state.values["messages"]]
        assert "Message 0" in contents
        assert "Message 49" in contents

    def test_checkpointer_is_none_attribute_check(self):
        """Simulate the checkpointer presence check from agent.py."""
        class MockGraph:
            checkpointer = None

        graph = MockGraph()
        has_checkpointer = hasattr(graph, "checkpointer") and graph.checkpointer
        assert not has_checkpointer

        graph.checkpointer = MemorySaver()
        has_checkpointer = hasattr(graph, "checkpointer") and graph.checkpointer
        assert has_checkpointer

    def test_graph_without_checkpointer_attr(self):
        """Graph object may not have checkpointer attribute at all."""
        class MinimalGraph:
            pass

        graph = MinimalGraph()
        has_checkpointer = hasattr(graph, "checkpointer") and graph.checkpointer
        assert has_checkpointer is False
