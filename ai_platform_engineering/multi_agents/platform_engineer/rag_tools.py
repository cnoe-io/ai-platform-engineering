# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
RAG tool wrappers for the platform engineer supervisor.

FetchDocumentCapWrapper enforces a per-query (per thread_id) call limit on the
fetch_document MCP tool to prevent runaway fetching in deep-research mode.
"""

import logging
import threading
import time
from typing import Any

from langchain_core.tools import BaseTool
from langgraph.config import get_config
from pydantic import PrivateAttr

logger = logging.getLogger(__name__)

# How many fetch_document calls are allowed per query (thread_id).
# Set to 0 to disable (block all calls). Override via env var.
_DEFAULT_MAX_FETCH_DOCUMENT_CALLS = 3
_STALE_ENTRY_TTL_SECONDS = 300  # clean up counters older than 5 minutes


class FetchDocumentCapWrapper(BaseTool):
  """
  Wraps the fetch_document MCP StructuredTool with a per-query call cap.

  Uses the LangGraph thread_id (from get_config()) to track how many times
  fetch_document has been called within a single graph invocation. Once the
  cap is reached, returns a guidance message instead of calling the real tool,
  preventing runaway fetch loops in deep-research mode.

  The counter is automatically cleaned up after _STALE_ENTRY_TTL_SECONDS to
  avoid memory leaks from long-running supervisor processes.
  """

  name: str = "fetch_document"
  description: str
  args_schema: Any  # raw JSON schema dict from MCP (StructuredTool accepts this)
  max_calls: int = _DEFAULT_MAX_FETCH_DOCUMENT_CALLS

  _original_tool: Any = PrivateAttr()
  _counts: dict = PrivateAttr()        # thread_id -> int
  _timestamps: dict = PrivateAttr()   # thread_id -> float (last call time)
  _lock: threading.Lock = PrivateAttr()

  def __init__(self, **kwargs: Any):
    super().__init__(**kwargs)
    self._counts = {}
    self._timestamps = {}
    self._lock = threading.Lock()
    self._original_tool = None

  @classmethod
  def from_tool(cls, original: Any, max_calls: int = _DEFAULT_MAX_FETCH_DOCUMENT_CALLS) -> "FetchDocumentCapWrapper":
    """
    Create a FetchDocumentCapWrapper from an existing MCP StructuredTool.

    Args:
        original: The StructuredTool instance returned by MultiServerMCPClient.get_tools()
        max_calls: Maximum fetch_document calls allowed per thread_id per query.
                   Defaults to _DEFAULT_MAX_FETCH_DOCUMENT_CALLS (3).
    """
    wrapper = cls(
      name=original.name,
      description=original.description,
      args_schema=original.args_schema,
      max_calls=max_calls,
    )
    wrapper._original_tool = original
    logger.info(f"FetchDocumentCapWrapper created (max_calls={max_calls})")
    return wrapper

  async def _arun(self, document_id: str, thought: str = "", **kwargs: Any) -> str:
    """
    Execute fetch_document with cap enforcement.

    Reads the current thread_id from the LangGraph runtime config, checks/
    increments the counter, and delegates to the original tool if under the cap.
    Returns a guidance message if the cap is exceeded.
    """
    config = get_config()
    thread_id = config.get("configurable", {}).get("thread_id", "__default__") if config else "__default__"

    with self._lock:
      self._cleanup_stale()
      count = self._counts.get(thread_id, 0)
      if count >= self.max_calls:
        logger.warning(
          f"fetch_document cap ({self.max_calls}) reached for thread_id={thread_id}. "
          "Returning limit message instead of calling the tool."
        )
        return (
          f"[fetch_document limit ({self.max_calls}) reached for this query. "
          "Use the search result snippets already retrieved to formulate your answer.]"
        )
      self._counts[thread_id] = count + 1
      self._timestamps[thread_id] = time.time()
      logger.debug(f"fetch_document call {count + 1}/{self.max_calls} for thread_id={thread_id}")

    return await self._original_tool.arun({"document_id": document_id, "thought": thought})

  def _run(self, *args: Any, **kwargs: Any) -> str:
    raise NotImplementedError("FetchDocumentCapWrapper only supports async execution via _arun")

  def _cleanup_stale(self) -> None:
    """
    Remove counter entries older than _STALE_ENTRY_TTL_SECONDS.
    Must be called under self._lock.
    """
    cutoff = time.time() - _STALE_ENTRY_TTL_SECONDS
    stale_keys = [k for k, v in self._timestamps.items() if v < cutoff]
    for k in stale_keys:
      self._counts.pop(k, None)
      self._timestamps.pop(k, None)
    if stale_keys:
      logger.debug(f"FetchDocumentCapWrapper: cleaned up {len(stale_keys)} stale thread_id entries")

  def get_call_count(self, thread_id: str) -> int:
    """Return current call count for a thread_id. Useful for testing."""
    with self._lock:
      return self._counts.get(thread_id, 0)
