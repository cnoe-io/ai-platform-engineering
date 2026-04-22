# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
RAG tool wrappers for the platform engineer supervisor.

Enforces per-query (per thread_id) call limits AND per-call output size limits
on RAG MCP tools to prevent:
  1. Runaway loops that exhaust the LangGraph recursion limit (call caps)
  2. Context window overflow from large RAG results (output truncation)

- FetchDocumentCapWrapper: caps fetch_document calls + truncates output
- SearchCapWrapper: caps search calls + truncates output

When the call cap is hit, both wrappers return a normal-looking success string
(not an error) that instructs the model to stop and synthesize. Raising
ToolInvocationError caused the model to retry with different arguments, which
defeated the cap.
"""

import contextvars
import logging
import os
import threading
import time
from typing import Any, ClassVar

from langchain_core.tools import BaseTool
from langgraph.config import get_config
from pydantic import PrivateAttr

logger = logging.getLogger(__name__)

# Conversation-scoped ID set at stream start by the A2A binding. Using a ContextVar
# means child graphs (spawned via the task tool in the same async context) inherit the
# same value automatically, so their RAG cap counters share the same bucket as the parent.
_rag_conversation_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "_rag_conversation_id", default=None
)


def set_rag_conversation_id(conversation_id: str) -> contextvars.Token:
    """Set the conversation ID for RAG cap tracking. Call once at stream start.

    Returns the ContextVar token so the caller can reset to the prior value
    when the stream ends (important in environments that reuse async contexts).
    """
    return _rag_conversation_id.set(conversation_id)


_DEFAULT_MAX_FETCH_DOCUMENT_CALLS = int(os.getenv("RAG_MAX_FETCH_DOCUMENT_CALLS", "5"))
_DEFAULT_MAX_SEARCH_CALLS = int(os.getenv("RAG_MAX_SEARCH_CALLS", "5"))
_STALE_ENTRY_TTL_SECONDS = 300

# Canonical cap-hit message used by both _arun wrappers and after_model.
# Single source of truth so the model always receives identical guidance.
RAG_CAP_EXHAUSTED_MESSAGE = (
    "No more search results available. The knowledge base has been fully searched. "
    "Do NOT call search or fetch_document again. "
    "You MUST now synthesize your final answer from the information already retrieved above."
)


# Per-call output truncation limits (chars). Prevents a single tool call from
# consuming a huge chunk of the context window. ~10K chars ≈ 2.5K tokens.
_DEFAULT_MAX_OUTPUT_CHARS = int(os.getenv("RAG_MAX_OUTPUT_CHARS", "10000"))

# Max results the search tool returns per call. The model often requests
# limit=10 or higher, flooding the context window with document metadata.
_DEFAULT_MAX_SEARCH_RESULTS = int(os.getenv("RAG_MAX_SEARCH_RESULTS", "3"))


class _CapCounterMixin:
  """Shared per-thread_id call counting and output truncation logic."""

  _global_counts: ClassVar[dict] = {}
  _global_timestamps: ClassVar[dict] = {}
  _global_lock: ClassVar[threading.Lock] = threading.Lock()

  def _get_thread_id(self) -> str:
    # Prefer the conversation-scoped ID set at stream start — this is the same value
    # in both parent and child graphs since ContextVar propagates through async tasks.
    conversation_id = _rag_conversation_id.get()
    if conversation_id:
      return conversation_id
    config = get_config()
    return config.get("configurable", {}).get("thread_id", "__default__") if config else "__default__"

  def _check_and_increment(self, thread_id: str, max_calls: int) -> int | None:
    """Check counter and increment if under cap. Returns None if OK, or the count if capped."""
    with self._global_lock:
      self._cleanup_stale()
      count = self._global_counts.get(thread_id, 0)
      if count >= max_calls:
        return count
      self._global_counts[thread_id] = count + 1
      self._global_timestamps[thread_id] = time.time()
      return None

  @staticmethod
  def _truncate_output(result: str, tool_name: str, max_chars: int = _DEFAULT_MAX_OUTPUT_CHARS) -> str:
    """Truncate tool output to prevent context window overflow."""
    if isinstance(result, str) and len(result) > max_chars:
      logger.info(f"{tool_name} output truncated: {len(result)} -> {max_chars} chars")
      return result[:max_chars] + f"\n\n[Output truncated — {len(result) - max_chars} chars omitted. Use the information above to answer.]"
    return result

  def _cleanup_stale(self) -> None:
    cutoff = time.time() - _STALE_ENTRY_TTL_SECONDS
    stale_keys = [k for k, v in self._global_timestamps.items() if v < cutoff]
    for k in stale_keys:
      self._global_counts.pop(k, None)
      self._global_timestamps.pop(k, None)
    if stale_keys:
      logger.debug(f"{type(self).__name__}: cleaned up {len(stale_keys)} stale entries")

  def get_call_count(self, thread_id: str) -> int:
    with self._global_lock:
      return self._global_counts.get(thread_id, 0)


class FetchDocumentCapWrapper(_CapCounterMixin, BaseTool):
  """Wraps fetch_document with a per-query call cap.

  Returns a normal-looking success string when the cap is hit so the model
  does not retry with different document IDs. The middleware's after_model
  hook intercepts any follow-up RAG calls once both caps are exhausted.
  """

  name: str = "fetch_document"
  description: str
  args_schema: Any
  max_calls: int = _DEFAULT_MAX_FETCH_DOCUMENT_CALLS

  _global_counts: ClassVar[dict] = {}
  _global_timestamps: ClassVar[dict] = {}
  _global_lock: ClassVar[threading.Lock] = threading.Lock()
  _active_max_calls: ClassVar[int] = _DEFAULT_MAX_FETCH_DOCUMENT_CALLS

  _original_tool: Any = PrivateAttr()

  def __init__(self, **kwargs: Any):
    super().__init__(**kwargs)
    self._original_tool = None

  @classmethod
  def from_tool(cls, original: Any, max_calls: int = _DEFAULT_MAX_FETCH_DOCUMENT_CALLS) -> "FetchDocumentCapWrapper":
    """Create a FetchDocumentCapWrapper from an existing MCP StructuredTool."""
    cls._active_max_calls = max_calls
    wrapper = cls(
      name=original.name,
      description=original.description,
      args_schema=original.args_schema,
      max_calls=max_calls,
    )
    wrapper._original_tool = original
    logger.info(
      f"FetchDocumentCapWrapper created (max_calls={max_calls}, "
      f"active_threads={len(cls._global_counts)})"
    )
    return wrapper

  @classmethod
  def get_max_calls(cls) -> int:
    return cls._active_max_calls

  async def _arun(self, document_id: str, thought: str = "", **kwargs: Any) -> str:
    thread_id = self._get_thread_id()
    capped = self._check_and_increment(thread_id, self.max_calls)
    if capped is not None:
      logger.warning(f"fetch_document cap ({self.max_calls}) reached for thread_id={thread_id}")
      _record_rag_cap_hit(thread_id, "fetch_document")
      return RAG_CAP_EXHAUSTED_MESSAGE

    count = self._global_counts.get(thread_id, 0)
    logger.debug(f"fetch_document call {count}/{self.max_calls} for thread_id={thread_id}")
    result = await self._original_tool.arun({"document_id": document_id, "thought": thought})
    return self._truncate_output(result, "fetch_document")

  def _run(self, *args: Any, **kwargs: Any) -> str:
    raise NotImplementedError("FetchDocumentCapWrapper only supports async execution via _arun")


class SearchCapWrapper(_CapCounterMixin, BaseTool):
  """Wraps the RAG search tool with a per-query call cap.

  Returns a normal-looking success string when the cap is hit so the model
  does not retry with different queries. The middleware's after_model hook
  intercepts any follow-up RAG calls once both caps are exhausted.
  """

  name: str = "search"
  description: str
  args_schema: Any
  max_calls: int = _DEFAULT_MAX_SEARCH_CALLS

  _global_counts: ClassVar[dict] = {}
  _global_timestamps: ClassVar[dict] = {}
  _global_lock: ClassVar[threading.Lock] = threading.Lock()
  _active_max_calls: ClassVar[int] = _DEFAULT_MAX_SEARCH_CALLS

  _original_tool: Any = PrivateAttr()

  def __init__(self, **kwargs: Any):
    super().__init__(**kwargs)
    self._original_tool = None

  @classmethod
  def from_tool(cls, original: Any, max_calls: int = _DEFAULT_MAX_SEARCH_CALLS) -> "SearchCapWrapper":
    """Create a SearchCapWrapper from an existing MCP StructuredTool."""
    cls._active_max_calls = max_calls
    wrapper = cls(
      name=original.name,
      description=original.description,
      args_schema=original.args_schema,
      max_calls=max_calls,
    )
    wrapper._original_tool = original
    logger.info(
      f"SearchCapWrapper created (max_calls={max_calls}, "
      f"active_threads={len(cls._global_counts)})"
    )
    return wrapper

  @classmethod
  def get_max_calls(cls) -> int:
    return cls._active_max_calls

  async def _arun(self, **kwargs: Any) -> str:
    thread_id = self._get_thread_id()
    capped = self._check_and_increment(thread_id, self.max_calls)
    if capped is not None:
      logger.warning(f"search cap ({self.max_calls}) reached for thread_id={thread_id}")
      _record_rag_cap_hit(thread_id, "search")
      return RAG_CAP_EXHAUSTED_MESSAGE

    # Cap per-call results to prevent context window flooding.
    if "limit" in kwargs and isinstance(kwargs["limit"], int):
      if kwargs["limit"] > _DEFAULT_MAX_SEARCH_RESULTS:
        logger.info(f"search limit capped: {kwargs['limit']} -> {_DEFAULT_MAX_SEARCH_RESULTS}")
        kwargs["limit"] = _DEFAULT_MAX_SEARCH_RESULTS
    elif "limit" not in kwargs:
      kwargs["limit"] = _DEFAULT_MAX_SEARCH_RESULTS

    count = self._global_counts.get(thread_id, 0)
    logger.debug(f"search call {count}/{self.max_calls} for thread_id={thread_id}")
    result = await self._original_tool.arun(kwargs)
    return self._truncate_output(result, "search")

  def _run(self, *args: Any, **kwargs: Any) -> str:
    raise NotImplementedError("SearchCapWrapper only supports async execution via _arun")


# Hard-stop tracking: after the first post-cap call, mark the thread so
# DeterministicTaskMiddleware.after_model can terminate the graph cleanly
# instead of running 500 recursion steps.
_rag_cap_hit_counts: dict[str, int] = {}
_rag_capped_tools: dict[str, set[str]] = {}
_rag_hard_stop_lock = threading.Lock()


def _record_rag_cap_hit(thread_id: str, tool_name: str = "") -> None:
    """Record a cap hit for a specific tool on this thread."""
    with _rag_hard_stop_lock:
        count = _rag_cap_hit_counts.get(thread_id, 0) + 1
        _rag_cap_hit_counts[thread_id] = count
        if tool_name:
            if thread_id not in _rag_capped_tools:
                _rag_capped_tools[thread_id] = set()
            _rag_capped_tools[thread_id].add(tool_name)
        logger.info(f"RAG cap hit for thread_id={thread_id}, tool={tool_name} (cap_hit_count={count})")


def is_rag_tool_capped(thread_id: str, tool_name: str) -> bool:
    """Return True if this specific tool has been capped for this thread."""
    with _rag_hard_stop_lock:
        return tool_name in _rag_capped_tools.get(thread_id, set())


def is_rag_hard_stopped(thread_id: str) -> bool:
    """Return True if ANY RAG tool has been capped for this thread."""
    with _rag_hard_stop_lock:
        return bool(_rag_capped_tools.get(thread_id))


def rag_batch_would_exceed_cap(
    thread_id: str,
    search_count: int,
    fetch_count: int,
    search_max: int = _DEFAULT_MAX_SEARCH_CALLS,
    fetch_max: int = _DEFAULT_MAX_FETCH_DOCUMENT_CALLS,
) -> bool:
    """Check whether dispatching a batch of RAG calls would exceed either cap.

    Called from after_model before LangGraph fans out tool calls in parallel.
    Holding both wrapper locks simultaneously gives a consistent snapshot —
    no concurrent _arun can increment between the two reads.

    Returns True if the batch should be intercepted (cap would be exceeded).
    Returns False if the batch is within budget — let the tools run normally.

    Intentionally does NOT increment counters. _arun owns all incrementing so
    there is no double-count.
    """
    with SearchCapWrapper._global_lock:
        with FetchDocumentCapWrapper._global_lock:
            current_search = SearchCapWrapper._global_counts.get(thread_id, 0)
            current_fetch = FetchDocumentCapWrapper._global_counts.get(thread_id, 0)
            return (
                (search_count > 0 and current_search + search_count > search_max)
                or (fetch_count > 0 and current_fetch + fetch_count > fetch_max)
            )


def clear_rag_state(thread_id: str) -> None:
    """Reset RAG cap counters for a thread at the start of a new query.

    Called at the start of each stream() invocation so that per-query caps are
    not carried over from a previous query on the same conversation thread.
    """
    with _rag_hard_stop_lock:
        _rag_capped_tools.pop(thread_id, None)
        _rag_cap_hit_counts.pop(thread_id, None)
    with SearchCapWrapper._global_lock:
        SearchCapWrapper._global_counts.pop(thread_id, None)
        SearchCapWrapper._global_timestamps.pop(thread_id, None)
    with FetchDocumentCapWrapper._global_lock:
        FetchDocumentCapWrapper._global_counts.pop(thread_id, None)
        FetchDocumentCapWrapper._global_timestamps.pop(thread_id, None)
    logger.debug(f"RAG state cleared for new query on thread_id={thread_id}")
