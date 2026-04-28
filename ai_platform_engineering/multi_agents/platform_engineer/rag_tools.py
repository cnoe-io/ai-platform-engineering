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

import logging
import os
import threading
import time
from typing import Any, ClassVar

from langchain_core.tools import BaseTool
from langgraph.config import get_config
from langgraph.prebuilt.tool_node import ToolInvocationError
from pydantic import PrivateAttr

logger = logging.getLogger(__name__)

_DEFAULT_MAX_FETCH_DOCUMENT_CALLS = int(os.getenv("RAG_MAX_FETCH_DOCUMENT_CALLS", "5"))
_DEFAULT_MAX_SEARCH_CALLS = int(os.getenv("RAG_MAX_SEARCH_CALLS", "5"))
_STALE_ENTRY_TTL_SECONDS = 300


# Per-call output truncation limits (chars). Prevents a single tool call from
# consuming a huge chunk of the context window. ~10K chars ≈ 2.5K tokens.
_DEFAULT_MAX_OUTPUT_CHARS = int(os.getenv("RAG_MAX_OUTPUT_CHARS", "10000"))

# Max results the search tool returns per call. The model often requests
# limit=10 or higher, flooding the context window with document metadata.
_DEFAULT_MAX_SEARCH_RESULTS = int(os.getenv("RAG_MAX_SEARCH_RESULTS", "3"))


class _RagToolCapExhausted(ToolInvocationError):
  """Raised when a per-query RAG tool cap is reached.

  Subclasses ToolInvocationError so LangGraph's ToolNode error handler
  converts it to an is_error=True ToolMessage — the semantic signal that
  tells the model the tool call FAILED (hard stop).
  """

  def __init__(self, message: str, tool_name: str) -> None:
    self.message = message
    self.tool_name = tool_name
    self.tool_kwargs: dict = {}
    self.source = None
    self.filtered_errors = None
    Exception.__init__(self, message)


class _CapCounterMixin:
  """Shared per-thread_id call counting and output truncation logic."""

  _global_counts: ClassVar[dict] = {}
  _global_timestamps: ClassVar[dict] = {}
  _global_lock: ClassVar[threading.Lock] = threading.Lock()

  def _get_thread_id(self) -> str:
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

  Raises _RagToolCapExhausted (ToolInvocationError) when the cap is hit,
  producing an is_error=True ToolMessage that the model treats as a hard stop.
  """

  name: str = "fetch_document"
  description: str
  args_schema: Any
  max_calls: int = _DEFAULT_MAX_FETCH_DOCUMENT_CALLS

  _global_counts: ClassVar[dict] = {}
  _global_timestamps: ClassVar[dict] = {}
  _global_lock: ClassVar[threading.Lock] = threading.Lock()

  _original_tool: Any = PrivateAttr()

  def __init__(self, **kwargs: Any):
    super().__init__(**kwargs)
    self._original_tool = None

  @classmethod
  def from_tool(cls, original: Any, max_calls: int = _DEFAULT_MAX_FETCH_DOCUMENT_CALLS) -> "FetchDocumentCapWrapper":
    """Create a FetchDocumentCapWrapper from an existing MCP StructuredTool."""
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

  async def _arun(self, document_id: str, thought: str = "", **kwargs: Any) -> str:
    thread_id = self._get_thread_id()
    capped = self._check_and_increment(thread_id, self.max_calls)
    if capped is not None:
      logger.warning(f"fetch_document cap ({self.max_calls}) reached for thread_id={thread_id}")
      _record_rag_cap_hit(thread_id, "fetch_document")
      # Return a normal-looking result so the model doesn't retry with different
      # document_ids. Raising ToolInvocationError creates is_error=True ToolMessages
      # which the model treats as "this doc failed, try the next" — causing a loop.
      return (
        f"[Document already retrieved] You have fetched {self.max_calls} documents which is the maximum allowed. "
        "All relevant content has been collected. Do NOT call fetch_document or search again. "
        "You MUST now synthesize your final answer using ONLY the documents already retrieved above."
      )

    count = self._global_counts.get(thread_id, 0)
    logger.debug(f"fetch_document call {count}/{self.max_calls} for thread_id={thread_id}")
    result = await self._original_tool.arun({"document_id": document_id, "thought": thought})
    return self._truncate_output(result, "fetch_document")

  def _run(self, *args: Any, **kwargs: Any) -> str:
    raise NotImplementedError("FetchDocumentCapWrapper only supports async execution via _arun")


class SearchCapWrapper(_CapCounterMixin, BaseTool):
  """Wraps the RAG search tool with a per-query call cap.

  Raises _RagToolCapExhausted (ToolInvocationError) when the cap is hit,
  producing an is_error=True ToolMessage that the model treats as a hard stop.
  """

  name: str = "search"
  description: str
  args_schema: Any
  max_calls: int = _DEFAULT_MAX_SEARCH_CALLS

  _global_counts: ClassVar[dict] = {}
  _global_timestamps: ClassVar[dict] = {}
  _global_lock: ClassVar[threading.Lock] = threading.Lock()

  _original_tool: Any = PrivateAttr()

  def __init__(self, **kwargs: Any):
    super().__init__(**kwargs)
    self._original_tool = None

  @classmethod
  def from_tool(cls, original: Any, max_calls: int = _DEFAULT_MAX_SEARCH_CALLS) -> "SearchCapWrapper":
    """Create a SearchCapWrapper from an existing MCP StructuredTool."""
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

  async def _arun(self, **kwargs: Any) -> str:
    thread_id = self._get_thread_id()
    capped = self._check_and_increment(thread_id, self.max_calls)
    if capped is not None:
      logger.warning(f"search cap ({self.max_calls}) reached for thread_id={thread_id}")
      _record_rag_cap_hit(thread_id, "search")
      return (
        f"[Search complete] You have performed {self.max_calls} searches which is the maximum allowed. "
        "All relevant results have been collected. Do NOT call search or fetch_document again. "
        "You MUST now synthesize your final answer using ONLY the information already retrieved above."
      )

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
_rag_synthesis_turn_given: set[str] = set()


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


def record_synthesis_turn_given(thread_id: str) -> None:
    """Mark that the model has already received one synthesis turn after cap exhaustion."""
    with _rag_hard_stop_lock:
        _rag_synthesis_turn_given.add(thread_id)


def was_synthesis_turn_given(thread_id: str) -> bool:
    """Return True if the model already received a synthesis turn for this thread."""
    with _rag_hard_stop_lock:
        return thread_id in _rag_synthesis_turn_given


def clear_rag_state(thread_id: str) -> None:
    """Reset RAG cap counters for a thread at the start of a new query.

    Called at the start of each stream() invocation so that per-query caps are
    not carried over from a previous query on the same conversation thread.
    """
    with _rag_hard_stop_lock:
        _rag_capped_tools.pop(thread_id, None)
        _rag_cap_hit_counts.pop(thread_id, None)
        _rag_synthesis_turn_given.discard(thread_id)
    with FetchDocumentCapWrapper._global_lock:
        FetchDocumentCapWrapper._global_counts.pop(thread_id, None)
        FetchDocumentCapWrapper._global_timestamps.pop(thread_id, None)
    with SearchCapWrapper._global_lock:
        SearchCapWrapper._global_counts.pop(thread_id, None)
        SearchCapWrapper._global_timestamps.pop(thread_id, None)
    logger.debug(f"RAG state cleared for new query on thread_id={thread_id}")
