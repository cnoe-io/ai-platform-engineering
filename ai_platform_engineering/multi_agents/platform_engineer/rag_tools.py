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
from langgraph.prebuilt.tool_node import ToolInvocationError
from pydantic import PrivateAttr

logger = logging.getLogger(__name__)

# How many fetch_document calls are allowed per query (thread_id).
# Set to 0 to disable (block all calls). Override via env var.
_DEFAULT_MAX_FETCH_DOCUMENT_CALLS = 5
_STALE_ENTRY_TTL_SECONDS = 300  # clean up counters older than 5 minutes


class _FetchDocumentCapExhausted(ToolInvocationError):
  """
  Raised when the per-query fetch_document cap is reached.

  Subclasses ToolInvocationError so LangGraph's default ToolNode error handler
  (_default_handle_tool_errors) catches it via isinstance check and converts it
  to an is_error=True ToolMessage.  Plain ToolException would be re-raised by
  the default handler and propagate up to stream.py as a graph crash.

  The is_error=True ToolMessage is the semantic signal that tells the model the
  tool call FAILED (hard stop), preventing the retry loop that a soft string
  return would cause.
  """

  def __init__(self, message: str) -> None:
    # ToolInvocationError.__init__ requires a ValidationError; bypass it.
    # We only need self.message for _default_handle_tool_errors to read.
    self.message = message
    self.tool_name = "fetch_document"
    self.tool_kwargs: dict = {}
    self.source = None
    self.filtered_errors = None
    Exception.__init__(self, message)


class FetchDocumentCapWrapper(BaseTool):
  """
  Wraps the fetch_document MCP StructuredTool with a per-query call cap.

  Uses the LangGraph thread_id (from get_config()) to track how many times
  fetch_document has been called within a single graph invocation. Once the
  cap is reached, raises _FetchDocumentCapExhausted (a ToolInvocationError
  subclass) instead of calling the real tool.

  LangGraph's ToolNode default error handler catches ToolInvocationError and
  creates an is_error=True ToolMessage.  The model treats that as a hard
  failure and stops retrying, unlike a plain string return which the model
  ignores and retries indefinitely.

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
                   Defaults to _DEFAULT_MAX_FETCH_DOCUMENT_CALLS (5).
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
    Returns a hard-stop instruction string when the cap is exceeded — phrased as
    a directive so the model treats it as a mandatory stop, not a retriable error.
    """
    config = get_config()
    thread_id = config.get("configurable", {}).get("thread_id", "__default__") if config else "__default__"

    with self._lock:
      self._cleanup_stale()
      count = self._counts.get(thread_id, 0)
      if count >= self.max_calls:
        logger.warning(
          f"fetch_document cap ({self.max_calls}) reached for thread_id={thread_id}. "
          "Returning hard-stop instruction to model."
        )
        return (
          f"[HARD LIMIT] fetch_document quota exhausted ({self.max_calls} calls used). "
          "You MUST NOT call fetch_document again for any document in this query. "
          "Synthesize your final answer RIGHT NOW using only the search snippets and "
          "documents already retrieved. Do not search further."
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
