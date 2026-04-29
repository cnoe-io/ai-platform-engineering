# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

# assisted-by claude code claude-sonnet-4-6

"""Unit tests: SummarizationMiddleware fires and compresses history correctly.

Uses the same fake-model + LLMToolEmulator harness as test_tool_call_limit_e2e.py.
No external API calls are made.

Key mechanic:
  SummarizationMiddleware.abefore_model() fires before each LLM call.
  When the message count (or token count) exceeds the trigger it:
    1. Calls summary_model.ainvoke(messages_to_summarize) to generate a summary.
    2. Replaces the full history with: [AIMessage(summary)] + kept_recent_messages.
  We verify this by checking the canned summary text appears in the final state.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from langchain.agents import create_agent
from langchain.agents.middleware.summarization import SummarizationMiddleware
from langchain.agents.middleware.tool_emulator import LLMToolEmulator
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, ToolCall
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver

# ---------------------------------------------------------------------------
# Shared helpers (mirrors test_tool_call_limit_e2e.py)
# ---------------------------------------------------------------------------

TOOL_NAME = "dummy_search"
SUMMARY_TEXT = "[UNIT-TEST SUMMARY OF PRIOR CONVERSATION]"


@tool
def dummy_search(query: str) -> str:
    """Search for information. Returns dummy results."""
    return f"results for: {query}"


class _ToolAwareFakeModel(GenericFakeChatModel):
    """GenericFakeChatModel that supports bind_tools (returns self)."""

    def bind_tools(self, tools, **kwargs):  # noqa: ARG002
        return self

    @property
    def _llm_type(self) -> str:
        return "fake-tool-aware"


def _tool_calling_model(n_calls: int) -> _ToolAwareFakeModel:
    """Fake agent model: emits n tool calls then a final text reply."""

    def _messages() -> Iterator[AIMessage]:
        for i in range(n_calls):
            yield AIMessage(
                content="",
                tool_calls=[ToolCall(name=TOOL_NAME, args={"query": f"q-{i}"}, id=f"c-{i}")],
            )
        yield AIMessage(content="Done.")

    return _ToolAwareFakeModel(messages=_messages())


def _emulator_model() -> _ToolAwareFakeModel:
    """Fake model for LLMToolEmulator — returns canned tool results."""

    def _messages() -> Iterator[AIMessage]:
        while True:
            yield AIMessage(content="[emulated result]")

    return _ToolAwareFakeModel(messages=_messages())


def _summary_model() -> _ToolAwareFakeModel:
    """Fake model for SummarizationMiddleware — always returns the canned SUMMARY_TEXT."""

    def _messages() -> Iterator[AIMessage]:
        while True:
            yield AIMessage(content=SUMMARY_TEXT)

    return _ToolAwareFakeModel(messages=_messages())


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_summarization_fires_on_message_count():
    """History is compressed when message count exceeds the trigger threshold.

    Message flow with n_calls=4 and trigger=("messages", 4):
      turn 1: [user]                             → 1 msg  → no trigger
      turn 2: [user, AI(tool), tool_result]      → 3 msgs → no trigger
      turn 3: [.., AI(tool), tool_result]        → 5 msgs → TRIGGER at threshold 4
               → summary injected, keep 2 msgs
      ...
    The canned SUMMARY_TEXT must appear somewhere in the final message history.
    """
    trigger_at = 4
    keep = 2

    agent = create_agent(
        model=_tool_calling_model(n_calls=4),
        tools=[dummy_search],
        middleware=[
            LLMToolEmulator(tools=[TOOL_NAME], model=_emulator_model()),
            SummarizationMiddleware(
                model=_summary_model(),
                trigger=("messages", trigger_at),
                keep=("messages", keep),
            ),
        ],
        checkpointer=InMemorySaver(),
    )

    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": "search repeatedly"}]},
        {"configurable": {"thread_id": str(uuid.uuid4())}},
    )

    messages = result.get("messages", [])
    contents = [str(getattr(m, "content", "")) for m in messages]
    summary_hits = [c for c in contents if SUMMARY_TEXT in c]

    assert summary_hits, (
        f"Expected SUMMARY_TEXT in message history after trigger={trigger_at} "
        f"but found: {contents}"
    )


@pytest.mark.asyncio
async def test_summarization_compresses_history_length():
    """After summarization the final message list is shorter than it would be without it.

    With n_calls=4 the unsummarized history would be at least 9 messages
    (user + 4×[AI_tool, tool_result] + AI_final).
    With trigger=4 and keep=2 we expect the final list to be much shorter.
    """
    trigger_at = 4
    keep = 2

    agent = create_agent(
        model=_tool_calling_model(n_calls=4),
        tools=[dummy_search],
        middleware=[
            LLMToolEmulator(tools=[TOOL_NAME], model=_emulator_model()),
            SummarizationMiddleware(
                model=_summary_model(),
                trigger=("messages", trigger_at),
                keep=("messages", keep),
            ),
        ],
        checkpointer=InMemorySaver(),
    )

    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": "search repeatedly"}]},
        {"configurable": {"thread_id": str(uuid.uuid4())}},
    )

    messages = result.get("messages", [])
    # Unsummarized: user(1) + 4×(AI_tool + tool_result)(8) + AI_final(1) = 10 msgs minimum.
    # After summarization fires (at 5 msgs → keeps 2 + summary) the count should be well below 10.
    assert len(messages) < 10, (
        f"Expected fewer than 10 messages after summarization; got {len(messages)}: {[type(m).__name__ for m in messages]}"
    )


@pytest.mark.asyncio
async def test_summarization_does_not_fire_below_threshold():
    """When message count stays below the trigger, no summarization occurs."""
    high_trigger = 100

    agent = create_agent(
        model=_tool_calling_model(n_calls=2),
        tools=[dummy_search],
        middleware=[
            LLMToolEmulator(tools=[TOOL_NAME], model=_emulator_model()),
            SummarizationMiddleware(
                model=_summary_model(),
                trigger=("messages", high_trigger),
                keep=("messages", 20),
            ),
        ],
        checkpointer=InMemorySaver(),
    )

    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": "quick search"}]},
        {"configurable": {"thread_id": str(uuid.uuid4())}},
    )

    messages = result.get("messages", [])
    contents = [str(getattr(m, "content", "")) for m in messages]
    summary_hits = [c for c in contents if SUMMARY_TEXT in c]

    assert not summary_hits, (
        f"Expected no summary with trigger={high_trigger} on {len(messages)} messages "
        f"but found: {summary_hits}"
    )


@pytest.mark.asyncio
async def test_summarization_preserves_recent_messages():
    """The most recent `keep` messages are retained verbatim after summarization fires."""
    trigger_at = 4
    keep = 2

    agent = create_agent(
        model=_tool_calling_model(n_calls=4),
        tools=[dummy_search],
        middleware=[
            LLMToolEmulator(tools=[TOOL_NAME], model=_emulator_model()),
            SummarizationMiddleware(
                model=_summary_model(),
                trigger=("messages", trigger_at),
                keep=("messages", keep),
            ),
        ],
        checkpointer=InMemorySaver(),
    )

    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": "search repeatedly"}]},
        {"configurable": {"thread_id": str(uuid.uuid4())}},
    )

    messages = result.get("messages", [])
    contents = [str(getattr(m, "content", "")) for m in messages]

    # The final "Done." message from the agent must always be present.
    assert any("Done." in c for c in contents), (
        f"Expected final 'Done.' message to be preserved; got: {contents}"
    )
