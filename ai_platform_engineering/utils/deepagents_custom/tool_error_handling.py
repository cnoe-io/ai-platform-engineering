# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Standalone utility to wrap tools with error handling for subagent resilience.

When MCP tools (or any tools) are passed to subagents via SubAgentMiddleware,
tool failures raise exceptions that propagate through LangGraph's ToolNode
(which only catches ToolInvocationError by default).  This crashes the entire
subagent graph and marks the deterministic task step as failed — even when the
LLM could have recovered by trying a different approach.

This module provides ``wrap_tools_with_error_handling`` to catch tool exceptions
and return error strings to the LLM, giving it a chance to self-correct.
"""

import asyncio
import logging
import os
from functools import wraps

from langchain_core.tools import BaseTool, StructuredTool

logger = logging.getLogger(__name__)

# Absolute safety cap for tool output. Set above FilesystemMiddleware's
# eviction threshold (20K tokens = ~80K chars) so that the library's
# eviction system handles normal large outputs.  This only kicks in for
# extreme cases (e.g. a tool dumping an entire database) where even
# eviction + read_file pagination wouldn't save the context window.
MAX_TOOL_OUTPUT_CHARS = int(os.getenv("MAX_TOOL_OUTPUT_CHARS", "200000"))


def _format_tool_error(tool_name: str, exc: Exception) -> str:
    """Build an informative but concise error string for the LLM."""
    error_text = str(exc).strip()
    if not error_text:
        error_text = type(exc).__name__
    return (
        f"Tool '{tool_name}' failed: {error_text}\n"
        f"You can retry with different arguments or use a different approach."
    )


def _make_error_response(msg: str, tool_name: str, exc: Exception, response_format: str):
    """Return the error in the format expected by the tool's response_format.

    Tools with response_format='content_and_artifact' require a (content, artifact)
    tuple; returning a plain string crashes LangChain's ToolNode validation.
    """
    if response_format == "content_and_artifact":
        return (msg, {"error": str(exc), "tool": tool_name})
    return msg


def _truncate(result: str, tool_name: str, max_chars: int = MAX_TOOL_OUTPUT_CHARS) -> str:
    if isinstance(result, str) and len(result) > max_chars:
        logger.warning(f"Tool '{tool_name}' output truncated from {len(result)} to {max_chars} chars")
        return result[:max_chars] + f"\n... [truncated, {len(result) - max_chars} chars omitted]"
    return result


def _truncate_any(result, tool_name: str, max_chars: int = MAX_TOOL_OUTPUT_CHARS):
    """Truncate every oversized string inside any tool return shape.

    LangChain tools can return str, (content, artifact) tuples, or other
    types.  We walk common container shapes and truncate every str element
    that exceeds max_chars.  This is a last-resort safety cap — normal large
    outputs should flow through to FilesystemMiddleware's eviction system,
    which gives the agent a preview and paginated read_file access.
    """
    if isinstance(result, str):
        return _truncate(result, tool_name, max_chars)
    if isinstance(result, tuple):
        return tuple(_truncate(el, tool_name, max_chars) if isinstance(el, str) else el for el in result)
    if isinstance(result, list):
        return _truncate(str(result), tool_name, max_chars)
    return result


def _normalize_result(result, tool_name: str, response_format: str):
    """Ensure the result matches the tool's declared response_format.

    MCP tools via langchain_mcp_adapters declare response_format='content_and_artifact'
    but sometimes return a plain string or None (e.g. empty results, edge cases).
    LangChain's ToolNode crashes if it doesn't receive a two-tuple.
    """
    if response_format != "content_and_artifact":
        return result
    if isinstance(result, tuple) and len(result) == 2:
        return result
    content = result if result is not None else f"Tool '{tool_name}' returned no results."
    if isinstance(content, str):
        content = _truncate(content, tool_name)
    return (content, [])


def wrap_tools_with_error_handling(
    tools: list[BaseTool],
    agent_name: str = "subagent",
) -> list[BaseTool]:
    """Wrap tools with error handling so exceptions become LLM-visible messages.

    This prevents MCP tool failures from crashing subagent graphs. The LLM
    receives the error text and can decide to retry or take a different path.

    Args:
        tools: LangChain tools (typically from MultiServerMCPClient.get_tools())
        agent_name: Label used in log messages

    Returns:
        New list of tools with error-handling wrappers applied.
    """
    wrapped: list[BaseTool] = []

    for tool in tools:
        try:
            tool_name = tool.name
            resp_fmt = getattr(tool, "response_format", "content")
            has_sync = hasattr(tool, "func") and tool.func is not None
            has_async = hasattr(tool, "coroutine") and tool.coroutine is not None

            if has_async and not has_sync:
                original_coro = tool.coroutine

                async def _safe_coro(
                    *args,
                    _orig=original_coro,
                    _name=tool_name,
                    _resp_fmt=resp_fmt,
                    **kwargs,
                ):
                    try:
                        result = await _orig(*args, **kwargs)
                        result = _truncate_any(result, _name)
                        return _normalize_result(result, _name, _resp_fmt)
                    except Exception as e:
                        msg = _format_tool_error(_name, e)
                        logger.warning(f"[{agent_name}] {msg}")
                        return _make_error_response(msg, _name, e, _resp_fmt)

                def _sync_fallback(
                    *args,
                    _async_fn=_safe_coro,
                    _name=tool_name,
                    _resp_fmt=resp_fmt,
                    **kwargs,
                ):
                    try:
                        try:
                            loop = asyncio.get_running_loop()
                        except RuntimeError:
                            loop = None

                        if loop and loop.is_running():
                            import nest_asyncio
                            nest_asyncio.apply()
                            return loop.run_until_complete(_async_fn(*args, **kwargs))
                        return asyncio.run(_async_fn(*args, **kwargs))
                    except Exception as e:
                        msg = _format_tool_error(_name, e)
                        logger.warning(f"[{agent_name}] sync fallback: {msg}")
                        return _make_error_response(msg, _name, e, _resp_fmt)

                new_tool = StructuredTool(
                    name=tool.name,
                    description=tool.description or "",
                    args_schema=tool.args_schema,
                    func=_sync_fallback,
                    coroutine=_safe_coro,
                    response_format=resp_fmt,
                    metadata=tool.metadata,
                )
                wrapped.append(new_tool)
            else:
                original_run = getattr(tool, "_run", None)
                original_arun = getattr(tool, "_arun", None)

                if original_run:
                    @wraps(original_run)
                    def _safe_run(
                        *args,
                        _orig=original_run,
                        _name=tool_name,
                        _resp_fmt=resp_fmt,
                        **kwargs,
                    ):
                        try:
                            result = _orig(*args, **kwargs)
                            result = _truncate_any(result, _name)
                            return _normalize_result(result, _name, _resp_fmt)
                        except Exception as e:
                            msg = _format_tool_error(_name, e)
                            logger.warning(f"[{agent_name}] {msg}")
                            return _make_error_response(msg, _name, e, _resp_fmt)

                    tool._run = _safe_run  # type: ignore[method-assign]

                if original_arun:
                    @wraps(original_arun)
                    async def _safe_arun(
                        *args,
                        _orig=original_arun,
                        _name=tool_name,
                        _resp_fmt=resp_fmt,
                        **kwargs,
                    ):
                        try:
                            result = await _orig(*args, **kwargs)
                            result = _truncate_any(result, _name)
                            return _normalize_result(result, _name, _resp_fmt)
                        except Exception as e:
                            msg = _format_tool_error(_name, e)
                            logger.warning(f"[{agent_name}] {msg}")
                            return _make_error_response(msg, _name, e, _resp_fmt)

                    tool._arun = _safe_arun  # type: ignore[method-assign]

                wrapped.append(tool)
        except Exception as e:
            logger.error(f"Failed to wrap tool {tool.name}: {e}", exc_info=True)
            wrapped.append(tool)

    logger.info(
        f"[{agent_name}] Wrapped {len(wrapped)} tools with error handling"
    )
    return wrapped
