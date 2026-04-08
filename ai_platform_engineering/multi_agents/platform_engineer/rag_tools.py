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

_DEFAULT_MAX_FETCH_DOCUMENT_CALLS = 5
_DEFAULT_MAX_SEARCH_CALLS = 5
_STALE_ENTRY_TTL_SECONDS = 300

# Per-call output truncation limits (chars). Prevents a single tool call from
# consuming a huge chunk of the context window. ~10K chars ≈ 2.5K tokens.
_DEFAULT_MAX_OUTPUT_CHARS = int(os.getenv("RAG_MAX_OUTPUT_CHARS", "10000"))


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
      return (
        f"[Search complete] You have performed {self.max_calls} searches which is the maximum allowed. "
        "All relevant results have been collected. Do NOT call search or fetch_document again. "
        "You MUST now synthesize your final answer using ONLY the information already retrieved above."
      )

    count = self._global_counts.get(thread_id, 0)
    logger.debug(f"search call {count}/{self.max_calls} for thread_id={thread_id}")
    result = await self._original_tool.arun(kwargs)
    return self._truncate_output(result, "search")

  def _run(self, *args: Any, **kwargs: Any) -> str:
    raise NotImplementedError("SearchCapWrapper only supports async execution via _arun")
