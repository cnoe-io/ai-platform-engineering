# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Automatic fact extraction from conversations using LangMem.

Uses `create_memory_store_manager` to analyze conversations after each agent
response and persist extracted facts/preferences/context to the cross-thread
LangGraph Store. Runs as a background asyncio task with zero impact on
response latency.

Configuration via environment variables:
    ENABLE_FACT_EXTRACTION: Enable/disable extraction (default: false)
    FACT_EXTRACTION_MODEL: Model name for extraction (empty = use default LLM)

Usage:
    from ai_platform_engineering.utils.agent_memory.fact_extraction import (
        is_fact_extraction_enabled,
        extract_and_store_facts,
    )

    if is_fact_extraction_enabled():
        asyncio.create_task(
            extract_and_store_facts(store=store, messages=messages, config=config)
        )
"""

import logging
import os
import time
from typing import Any, Optional

from langchain_core.messages import BaseMessage

logger = logging.getLogger(__name__)

_FACT_EXTRACTOR = None

EXTRACTION_INSTRUCTIONS = (
    "You are a memory manager for a platform engineering AI assistant. "
    "Extract key facts, user preferences, environment details, and project "
    "context from conversations. Focus on information that would be useful "
    "in future conversations with the same user.\n\n"
    "Prioritize:\n"
    "- Infrastructure details (clusters, namespaces, tools in use)\n"
    "- User preferences (response style, output format)\n"
    "- Team/project context (team name, project names, environments)\n"
    "- Recurring patterns (frequently accessed resources, common tasks)\n\n"
    "Avoid storing:\n"
    "- Transient operational data (current pod status, temporary errors)\n"
    "- Sensitive credentials or tokens\n"
    "- Information that changes frequently (metric values, timestamps)\n"
)


def is_fact_extraction_enabled() -> bool:
    """Check if automatic fact extraction is enabled via environment variable."""
    return os.getenv("ENABLE_FACT_EXTRACTION", "false").lower() == "true"


def _get_extraction_model():
    """Get the LLM model for fact extraction."""
    model_name = os.getenv("FACT_EXTRACTION_MODEL", "").strip()
    if model_name:
        from langchain.chat_models import init_chat_model
        return init_chat_model(model_name)

    from cnoe_agent_utils import LLMFactory
    return LLMFactory().get_llm()


def create_fact_extractor(store: Any) -> Any:
    """
    Create or return a cached MemoryStoreManager for fact extraction.

    Args:
        store: LangGraph BaseStore instance for memory persistence.

    Returns:
        A MemoryStoreManager instance, or None if creation fails.
    """
    global _FACT_EXTRACTOR

    if _FACT_EXTRACTOR is not None:
        return _FACT_EXTRACTOR

    try:
        from langmem import create_memory_store_manager

        model = _get_extraction_model()

        _FACT_EXTRACTOR = create_memory_store_manager(
            model,
            instructions=EXTRACTION_INSTRUCTIONS,
            namespace=("memories", "{langgraph_user_id}"),
            store=store,
            enable_inserts=True,
            enable_deletes=False,
        )

        logger.info("Fact extractor (MemoryStoreManager) created successfully")
        return _FACT_EXTRACTOR

    except ImportError:
        logger.warning(
            "langmem not installed; fact extraction unavailable. "
            "Install with: pip install langmem"
        )
        return None
    except Exception as e:
        logger.error(f"Failed to create fact extractor: {e}")
        return None


def reset_fact_extractor() -> None:
    """Reset the cached fact extractor (for testing)."""
    global _FACT_EXTRACTOR
    _FACT_EXTRACTOR = None


def _build_extraction_config(
    user_id: str,
    thread_id: Optional[str] = None,
) -> dict:
    """
    Build a RunnableConfig with the keys MemoryStoreManager expects.

    The namespace template `("memories", "{langgraph_user_id}")` resolves
    `{langgraph_user_id}` from `config["configurable"]["langgraph_user_id"]`.
    """
    return {
        "configurable": {
            "langgraph_user_id": user_id,
            "thread_id": thread_id or "",
        },
    }


async def extract_and_store_facts(
    store: Any,
    messages: list[BaseMessage],
    user_id: str,
    thread_id: Optional[str] = None,
) -> None:
    """
    Extract facts from conversation messages and persist to the store.

    This function is designed to be called via `asyncio.create_task()` after
    the agent finishes streaming a response. Failures are logged but never
    propagated to the caller.

    Args:
        store: LangGraph BaseStore instance.
        messages: Conversation messages from the current thread.
        user_id: User identifier for namespace scoping.
        thread_id: Optional thread_id for traceability.
    """
    if not messages or not user_id:
        logger.debug("Fact extraction skipped: no messages or user_id")
        return

    start = time.time()

    try:
        extractor = create_fact_extractor(store)
        if extractor is None:
            return

        config = _build_extraction_config(user_id, thread_id)

        logger.info(
            f"Starting background fact extraction for user={user_id}, "
            f"thread={thread_id}, messages={len(messages)}"
        )

        results = await extractor.ainvoke(
            {"messages": messages},
            config=config,
        )

        elapsed_ms = (time.time() - start) * 1000
        result_count = len(results) if results else 0

        logger.info(
            f"Fact extraction complete: {result_count} memory operations "
            f"for user={user_id} in {elapsed_ms:.0f}ms"
        )

    except Exception as e:
        elapsed_ms = (time.time() - start) * 1000
        logger.error(
            f"Fact extraction failed for user={user_id} "
            f"after {elapsed_ms:.0f}ms: {e}"
        )
