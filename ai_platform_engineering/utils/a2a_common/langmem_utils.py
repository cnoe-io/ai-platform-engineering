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

from langchain_core.messages import BaseMessage, SystemMessage

logger = logging.getLogger(__name__)

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

            summarizer = create_thread_extractor(
                model=model,
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

