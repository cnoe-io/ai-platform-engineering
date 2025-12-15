# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
LangMem Utilities for Context Summarization

Provides centralized LangMem integration with:
- Availability checking
- Consistent summarization API
- Structured logging and metrics
- Graceful fallback to simple deletion
- Startup verification

Usage:
    from ai_platform_engineering.utils.a2a_common.langmem_utils import (
        is_langmem_available,
        summarize_messages,
        verify_langmem_on_startup,
    )

    # Check availability
    if is_langmem_available():
        result = await summarize_messages(messages, model)
        if result.success:
            print(f"Summarized {result.messages_removed} messages, saved {result.tokens_saved} tokens")
"""

import logging
import os
import time
from dataclasses import dataclass
from typing import Any, List, Optional

from langchain_core.messages import BaseMessage, SystemMessage, AIMessage, ToolMessage

logger = logging.getLogger(__name__)


def _find_safe_summarization_boundary(messages: List[BaseMessage], min_keep: int) -> int:
    """
    Find a safe index to split messages for summarization.
    
    Ensures we don't split in the middle of tool call/result pairs, which would
    cause LLM validation errors like "Expected toolResult blocks for the following Ids".
    
    Args:
        messages: List of messages to analyze
        min_keep: Minimum number of recent messages to keep
        
    Returns:
        Index where it's safe to split (messages[:index] can be summarized)
    """
    if len(messages) <= min_keep:
        return 0
    
    # Start from the proposed cut point
    cut_index = len(messages) - min_keep
    
    # Track pending tool calls that need results
    pending_tool_calls = set()
    
    # Scan from cut point to end to find pending tool calls in "keep" section
    for i in range(cut_index, len(messages)):
        msg = messages[i]
        
        # Check for tool calls in AI messages
        if isinstance(msg, AIMessage):
            tool_calls = getattr(msg, 'tool_calls', None) or []
            for tc in tool_calls:
                tc_id = tc.get('id') if isinstance(tc, dict) else getattr(tc, 'id', None)
                if tc_id:
                    pending_tool_calls.add(tc_id)
        
        # Check for tool results
        if isinstance(msg, ToolMessage):
            tc_id = getattr(msg, 'tool_call_id', None)
            if tc_id and tc_id in pending_tool_calls:
                pending_tool_calls.discard(tc_id)
    
    # If no pending tool calls, cut point is safe
    if not pending_tool_calls:
        return cut_index
    
    # Move cut point backward until we include all tool calls for pending results
    # Or find a safe boundary
    for i in range(cut_index - 1, -1, -1):
        msg = messages[i]
        
        if isinstance(msg, AIMessage):
            tool_calls = getattr(msg, 'tool_calls', None) or []
            for tc in tool_calls:
                tc_id = tc.get('id') if isinstance(tc, dict) else getattr(tc, 'id', None)
                if tc_id and tc_id in pending_tool_calls:
                    # Found the tool call, need to keep it
                    # Move cut point before this message
                    cut_index = i
                    pending_tool_calls.discard(tc_id)
        
        if not pending_tool_calls:
            break
    
    # Final check: make sure messages[:cut_index] doesn't end with an AI message with tool calls
    while cut_index > 0:
        last_msg = messages[cut_index - 1]
        if isinstance(last_msg, AIMessage):
            tool_calls = getattr(last_msg, 'tool_calls', None) or []
            if tool_calls:
                # This AI message has tool calls - check if results are in summarize section
                has_all_results = True
                for tc in tool_calls:
                    tc_id = tc.get('id') if isinstance(tc, dict) else getattr(tc, 'id', None)
                    if tc_id:
                        # Look for matching ToolMessage in messages[:cut_index]
                        found = False
                        for j in range(cut_index):
                            if isinstance(messages[j], ToolMessage):
                                if getattr(messages[j], 'tool_call_id', None) == tc_id:
                                    found = True
                                    break
                        if not found:
                            has_all_results = False
                            break
                
                if not has_all_results:
                    cut_index -= 1
                    continue
        break
    
    logger.debug(f"Safe summarization boundary: {cut_index} (keeping {len(messages) - cut_index} messages)")
    return cut_index

# ============================================================================
# LangMem Availability
# ============================================================================

_LANGMEM_AVAILABLE: Optional[bool] = None
_LANGMEM_VERIFIED: bool = False


def is_langmem_available() -> bool:
    """
    Check if LangMem is available for use.

    Returns:
        True if langmem package is installed and importable
    """
    global _LANGMEM_AVAILABLE

    if _LANGMEM_AVAILABLE is None:
        try:
            from langmem import create_thread_extractor  # noqa: F401
            _LANGMEM_AVAILABLE = True
            logger.info("✅ LangMem is available for context summarization")
        except ImportError:
            _LANGMEM_AVAILABLE = False
            logger.warning("⚠️ LangMem not available - will use simple message deletion for context management")

    return _LANGMEM_AVAILABLE


def is_langmem_verified() -> bool:
    """Check if LangMem has been verified to work (successful test summarization)."""
    return _LANGMEM_VERIFIED


# ============================================================================
# Summarization Result
# ============================================================================

@dataclass
class SummarizationResult:
    """Result of a summarization operation."""
    success: bool
    summary_message: Optional[SystemMessage] = None
    messages_removed: int = 0
    tokens_before: int = 0
    tokens_after: int = 0
    tokens_saved: int = 0
    duration_ms: float = 0.0
    error: Optional[str] = None
    used_langmem: bool = False

    @property
    def compression_ratio(self) -> float:
        """Return compression ratio (0.0 to 1.0, lower = better compression)."""
        if self.tokens_before == 0:
            return 1.0
        return self.tokens_after / self.tokens_before


# ============================================================================
# Core Summarization
# ============================================================================

async def summarize_messages(
    messages: List[BaseMessage],
    model: Any,
    instructions: str = "Summarize the key points and context from this conversation.",
    agent_name: str = "agent",
) -> SummarizationResult:
    """
    Summarize a list of messages using LangMem.

    Args:
        messages: List of messages to summarize
        model: LLM model instance (from LLMFactory().get_llm())
        instructions: Custom summarization instructions
        agent_name: Name of the calling agent (for logging)

    Returns:
        SummarizationResult with summary and metrics
    """
    if not messages:
        return SummarizationResult(
            success=True,
            messages_removed=0,
            error="No messages to summarize"
        )

    start_time = time.time()
    tokens_before = _estimate_tokens(messages)

    # Try LangMem first
    if is_langmem_available():
        try:
            from langmem import create_thread_extractor

            logger.info(
                f"🧠 [{agent_name}] LangMem summarizing {len(messages)} messages "
                f"(~{tokens_before:,} tokens)..."
            )

            # Note: In langmem 0.0.30+, 'model' is a positional-only argument
            summarizer = create_thread_extractor(
                model,  # positional argument
                instructions=instructions,
            )

            summary_result = await summarizer.ainvoke({"messages": messages})
            summary_text = (
                summary_result.summary
                if hasattr(summary_result, 'summary')
                else str(summary_result)
            )

            summary_message = SystemMessage(content=f"[Conversation Summary]\n{summary_text}")
            tokens_after = _estimate_tokens([summary_message])
            duration_ms = (time.time() - start_time) * 1000

            result = SummarizationResult(
                success=True,
                summary_message=summary_message,
                messages_removed=len(messages),
                tokens_before=tokens_before,
                tokens_after=tokens_after,
                tokens_saved=tokens_before - tokens_after,
                duration_ms=duration_ms,
                used_langmem=True,
            )

            logger.info(
                f"✨ [{agent_name}] LangMem summarization complete: "
                f"{result.messages_removed} msgs → 1 summary, "
                f"{result.tokens_before:,} → {result.tokens_after:,} tokens "
                f"({result.compression_ratio:.1%} of original), "
                f"saved {result.tokens_saved:,} tokens in {result.duration_ms:.0f}ms"
            )

            # Mark as verified on first successful summarization
            global _LANGMEM_VERIFIED
            _LANGMEM_VERIFIED = True

            return result

        except Exception as e:
            logger.error(f"❌ [{agent_name}] LangMem summarization failed: {e}")
            # Fall through to fallback

    # Fallback: Simple concatenation (not as good, but preserves info)
    return _fallback_summarize(messages, agent_name, tokens_before, start_time)


def _fallback_summarize(
    messages: List[BaseMessage],
    agent_name: str,
    tokens_before: int,
    start_time: float,
) -> SummarizationResult:
    """Fallback summarization using simple concatenation."""
    try:
        # Create a simple summary by taking first/last messages
        summary_parts = []

        # Include first message for context
        if messages:
            first_content = _get_message_content(messages[0])
            if first_content:
                summary_parts.append(f"[Start] {first_content[:500]}...")

        # Include last few messages for recency
        recent = messages[-3:] if len(messages) > 3 else messages[1:]
        for msg in recent:
            content = _get_message_content(msg)
            if content:
                role = msg.__class__.__name__.replace("Message", "")
                summary_parts.append(f"[{role}] {content[:300]}...")

        summary_text = "\n".join(summary_parts)
        summary_message = SystemMessage(
            content=f"[Fallback Summary - {len(messages)} messages compressed]\n{summary_text}"
        )

        tokens_after = _estimate_tokens([summary_message])
        duration_ms = (time.time() - start_time) * 1000

        result = SummarizationResult(
            success=True,
            summary_message=summary_message,
            messages_removed=len(messages),
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            tokens_saved=tokens_before - tokens_after,
            duration_ms=duration_ms,
            used_langmem=False,
        )

        logger.warning(
            f"⚠️ [{agent_name}] Fallback summarization: "
            f"{result.messages_removed} msgs, saved {result.tokens_saved:,} tokens "
            f"(LangMem not used)"
        )

        return result

    except Exception as e:
        return SummarizationResult(
            success=False,
            error=f"Fallback summarization failed: {e}",
        )


# ============================================================================
# Startup Verification
# ============================================================================

async def verify_langmem_on_startup(model: Any, agent_name: str = "startup") -> bool:
    """
    Verify LangMem is working by performing a test summarization.

    Call this at agent startup to confirm LangMem integration works.

    Args:
        model: LLM model instance
        agent_name: Name for logging

    Returns:
        True if LangMem is working, False otherwise
    """
    if not is_langmem_available():
        logger.warning(f"[{agent_name}] LangMem verification skipped - not available")
        return False

    # Skip if already verified or if env var disables verification
    if is_langmem_verified():
        logger.debug(f"[{agent_name}] LangMem already verified")
        return True

    if os.getenv("SKIP_LANGMEM_VERIFICATION", "false").lower() == "true":
        logger.info(f"[{agent_name}] LangMem verification skipped (SKIP_LANGMEM_VERIFICATION=true)")
        return True

    # Create test messages
    test_messages = [
        SystemMessage(content="You are a helpful assistant."),
        SystemMessage(content="The user asked about weather. You provided a forecast."),
        SystemMessage(content="The user then asked about travel. You suggested destinations."),
    ]

    logger.info(f"[{agent_name}] Verifying LangMem with test summarization...")

    result = await summarize_messages(
        messages=test_messages,
        model=model,
        instructions="Create a brief summary of this test conversation.",
        agent_name=f"{agent_name}-verify",
    )

    if result.success and result.used_langmem:
        logger.info(f"✅ [{agent_name}] LangMem verified successfully!")
        return True
    else:
        logger.warning(f"⚠️ [{agent_name}] LangMem verification failed: {result.error}")
        return False


# ============================================================================
# Helpers
# ============================================================================

def _estimate_tokens(messages: List[BaseMessage]) -> int:
    """Estimate token count for messages (rough approximation: 4 chars = 1 token)."""
    total_chars = sum(len(_get_message_content(m)) for m in messages)
    return total_chars // 4


def _get_message_content(message: BaseMessage) -> str:
    """Safely extract content from a message."""
    if hasattr(message, 'content'):
        content = message.content
        if isinstance(content, str):
            return content
        elif isinstance(content, list):
            # Handle list content (e.g., multimodal messages)
            return " ".join(str(c) for c in content if c)
    return ""


# ============================================================================
# Proactive Context Management
# ============================================================================

@dataclass
class ContextCheckResult:
    """Result of a pre-flight context check."""
    needs_compression: bool
    estimated_tokens: int
    threshold_tokens: int
    history_tokens: int
    system_tokens: int
    query_tokens: int
    tool_tokens: int
    compressed: bool = False
    tokens_saved: int = 0
    used_langmem: bool = False
    error: Optional[str] = None


async def preflight_context_check(
    graph: Any,
    config: Any,
    query: str,
    system_prompt: str = "",
    model: Any = None,
    agent_name: str = "agent",
    max_context_tokens: int = 100000,
    min_messages_to_keep: int = 4,
    tool_count: int = 40,
) -> ContextCheckResult:
    """
    Proactively check context usage and compress if needed BEFORE calling LLM.

    This prevents "Input is too long" errors by summarizing history when
    approaching the context limit.

    Args:
        graph: LangGraph instance with aget_state/aupdate_state
        config: Runnable configuration with thread_id
        query: Current query to be sent
        system_prompt: System prompt content (for token estimation)
        model: LLM model for summarization (required if compression needed)
        agent_name: Name for logging
        max_context_tokens: Maximum context window (default 100K)
        min_messages_to_keep: Minimum recent messages to preserve
        tool_count: Number of tools (for schema overhead estimation)

    Returns:
        ContextCheckResult with status and metrics

    Example:
        result = await preflight_context_check(
            graph=self.graph,
            config=config,
            query=user_query,
            system_prompt=SYSTEM_PROMPT,
            model=llm,
            agent_name="supervisor",
            max_context_tokens=100000,
        )
        if result.compressed:
            logger.info(f"Context compressed, saved {result.tokens_saved} tokens")
    """
    try:
        # Get current state
        state = await graph.aget_state(config)
        if not state or not state.values:
            return ContextCheckResult(
                needs_compression=False,
                estimated_tokens=0,
                threshold_tokens=int(max_context_tokens * 0.8),
                history_tokens=0,
                system_tokens=0,
                query_tokens=0,
                tool_tokens=0,
            )

        messages = state.values.get("messages", [])
        if not messages:
            return ContextCheckResult(
                needs_compression=False,
                estimated_tokens=0,
                threshold_tokens=int(max_context_tokens * 0.8),
                history_tokens=0,
                system_tokens=0,
                query_tokens=0,
                tool_tokens=0,
            )

        # Estimate tokens
        system_tokens = len(system_prompt) // 4  # ~4 chars per token
        history_tokens = _estimate_tokens(messages)
        query_tokens = len(query) // 4
        tool_tokens = tool_count * 500  # ~500 tokens per tool schema

        total_estimated = system_tokens + history_tokens + query_tokens + tool_tokens
        threshold = int(max_context_tokens * 0.8)

        if total_estimated <= threshold:
            logger.debug(
                f"[{agent_name}] Pre-flight check passed: "
                f"{total_estimated:,} / {max_context_tokens:,} tokens"
            )
            return ContextCheckResult(
                needs_compression=False,
                estimated_tokens=total_estimated,
                threshold_tokens=threshold,
                history_tokens=history_tokens,
                system_tokens=system_tokens,
                query_tokens=query_tokens,
                tool_tokens=tool_tokens,
            )

        # Need compression!
        logger.warning(
            f"⚠️ [{agent_name}] Pre-flight check detected potential overflow: "
            f"{total_estimated:,} tokens (threshold: {threshold:,}). "
            f"System: {system_tokens:,}, History: {history_tokens:,}, "
            f"Query: {query_tokens:,}, Tools: {tool_tokens:,}"
        )

        if model is None:
            return ContextCheckResult(
                needs_compression=True,
                estimated_tokens=total_estimated,
                threshold_tokens=threshold,
                history_tokens=history_tokens,
                system_tokens=system_tokens,
                query_tokens=query_tokens,
                tool_tokens=tool_tokens,
                error="Model not provided for compression",
            )

        # Find safe boundary that doesn't split tool call/result pairs
        safe_cut_index = _find_safe_summarization_boundary(messages, min_messages_to_keep)
        messages_to_summarize = messages[:safe_cut_index]
        messages_to_keep = messages[safe_cut_index:]

        if not messages_to_summarize:
            logger.info(f"[{agent_name}] Not enough messages to summarize (keeping {len(messages_to_keep)})")
            return ContextCheckResult(
                needs_compression=True,
                estimated_tokens=total_estimated,
                threshold_tokens=threshold,
                history_tokens=history_tokens,
                system_tokens=system_tokens,
                query_tokens=query_tokens,
                tool_tokens=tool_tokens,
                error="Not enough messages to summarize",
            )

        # Summarize
        result = await summarize_messages(
            messages=messages_to_summarize,
            model=model,
            agent_name=agent_name,
        )

        if result.success and result.summary_message:
            # Import RemoveMessage here to avoid circular imports
            from langgraph.graph.message import RemoveMessage

            # Remove old messages
            remove_commands = []
            for msg in messages_to_summarize:
                msg_id = getattr(msg, 'id', None) or (msg.get('id') if isinstance(msg, dict) else None)
                if msg_id:
                    remove_commands.append(RemoveMessage(id=msg_id))

            if remove_commands:
                await graph.aupdate_state(config, {"messages": remove_commands})
                await graph.aupdate_state(config, {"messages": [result.summary_message]})

                new_history_tokens = _estimate_tokens([result.summary_message] + messages_to_keep)
                new_total = system_tokens + new_history_tokens + query_tokens + tool_tokens

                logger.info(
                    f"✅ [{agent_name}] Context compressed: "
                    f"{total_estimated:,} → {new_total:,} tokens. "
                    f"LangMem used: {result.used_langmem}, "
                    f"saved {result.tokens_saved:,} tokens"
                )

                return ContextCheckResult(
                    needs_compression=True,
                    estimated_tokens=new_total,
                    threshold_tokens=threshold,
                    history_tokens=new_history_tokens,
                    system_tokens=system_tokens,
                    query_tokens=query_tokens,
                    tool_tokens=tool_tokens,
                    compressed=True,
                    tokens_saved=result.tokens_saved,
                    used_langmem=result.used_langmem,
                )

        # Summarization failed
        return ContextCheckResult(
            needs_compression=True,
            estimated_tokens=total_estimated,
            threshold_tokens=threshold,
            history_tokens=history_tokens,
            system_tokens=system_tokens,
            query_tokens=query_tokens,
            tool_tokens=tool_tokens,
            error=result.error or "Summarization returned no summary",
        )

    except Exception as e:
        logger.error(f"[{agent_name}] Pre-flight check error: {e}", exc_info=True)
        return ContextCheckResult(
            needs_compression=False,
            estimated_tokens=0,
            threshold_tokens=int(max_context_tokens * 0.8),
            history_tokens=0,
            system_tokens=0,
            query_tokens=0,
            tool_tokens=0,
            error=str(e),
        )


# ============================================================================
# Status Reporting
# ============================================================================

def get_langmem_status() -> dict:
    """
    Get current LangMem status for health checks and debugging.

    Returns:
        Dict with status information
    """
    return {
        "available": is_langmem_available(),
        "verified": is_langmem_verified(),
        "env_skip_verification": os.getenv("SKIP_LANGMEM_VERIFICATION", "false").lower() == "true",
    }


