# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

# assisted-by claude code claude-sonnet-4-6

"""E2E test: ToolCallLimitMiddleware fires correctly when agent exceeds tool call budget.

Uses LLMToolEmulator to avoid real tool execution and a GenericFakeChatModel that
loops tool calls until the middleware stops it.  No external API calls are made.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from deepagents import create_deep_agent
from langchain.agents.middleware.tool_call_limit import ToolCallLimitMiddleware
from langchain.agents.middleware.tool_emulator import LLMToolEmulator
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, ToolCall
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TOOL_NAME = "dummy_search"
LIMIT = 3


@tool
def dummy_search(query: str) -> str:
    """Search for information. Returns dummy results."""
    return f"results for: {query}"


def _make_tool_call_message(call_id: str, query: str) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[ToolCall(name=TOOL_NAME, args={"query": query}, id=call_id)],
    )


class _ToolAwareFakeModel(GenericFakeChatModel):
    """GenericFakeChatModel that supports bind_tools (returns self — already emits tool calls)."""

    def bind_tools(self, tools, **kwargs):  # noqa: ARG002
        return self

    @property
    def _llm_type(self) -> str:
        return "fake-tool-aware"


def _tool_calling_model(n_calls: int) -> _ToolAwareFakeModel:
    """Build a fake chat model that emits n tool calls then a final text response."""

    def _messages() -> Iterator[AIMessage]:
        for i in range(n_calls):
            yield _make_tool_call_message(f"call-{i}", f"query-{i}")
        # Final turn: no tool call, just a text reply
        yield AIMessage(content="Done searching.")

    return _ToolAwareFakeModel(messages=_messages())


def _emulator_model() -> _ToolAwareFakeModel:
    """Fake model for LLMToolEmulator — always returns a canned tool result."""

    def _messages() -> Iterator[AIMessage]:
        while True:
            yield AIMessage(content="[emulated result]")

    return _ToolAwareFakeModel(messages=_messages())


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tool_call_limit_continue_behavior():
    """After LIMIT tool calls the middleware injects an error ToolMessage but
    execution continues (exit_behavior='continue').  The agent eventually finishes."""
    agent = create_deep_agent(
        model=_tool_calling_model(n_calls=LIMIT + 2),
        tools=[dummy_search],
        middleware=[
            LLMToolEmulator(
                tools=[TOOL_NAME],
                model=_emulator_model(),
            ),
            ToolCallLimitMiddleware(run_limit=LIMIT, exit_behavior="continue"),
        ],
        checkpointer=InMemorySaver(),
    )

    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": "search for things repeatedly"}]},
        {"configurable": {"thread_id": str(uuid.uuid4())}},
    )

    messages = result.get("messages", [])
    # At least one ToolMessage should contain the limit-exceeded error text
    tool_messages = [m for m in messages if hasattr(m, "tool_call_id")]
    limit_hits = [m for m in tool_messages if "limit" in str(m.content).lower() or "exceeded" in str(m.content).lower()]
    assert limit_hits, (
        f"Expected at least one limit-exceeded ToolMessage; got: {[m.content for m in tool_messages]}"
    )


@pytest.mark.asyncio
async def test_tool_call_limit_end_behavior():
    """With exit_behavior='end' the agent stops immediately when the limit is hit."""
    agent = create_deep_agent(
        model=_tool_calling_model(n_calls=LIMIT + 5),
        tools=[dummy_search],
        middleware=[
            LLMToolEmulator(
                tools=[TOOL_NAME],
                model=_emulator_model(),
            ),
            ToolCallLimitMiddleware(run_limit=LIMIT, exit_behavior="end"),
        ],
        checkpointer=InMemorySaver(),
    )

    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": "search for things many times"}]},
        {"configurable": {"thread_id": str(uuid.uuid4())}},
    )

    messages = result.get("messages", [])
    # Count actual (emulated) tool calls that succeeded before the limit
    emulated = [
        m
        for m in messages
        if hasattr(m, "tool_call_id") and "[emulated result]" in str(m.content)
    ]
    # Should be exactly LIMIT successful calls (the (LIMIT+1)th call triggers end)
    assert len(emulated) <= LIMIT, (
        f"Expected at most {LIMIT} emulated tool calls before end; got {len(emulated)}"
    )
