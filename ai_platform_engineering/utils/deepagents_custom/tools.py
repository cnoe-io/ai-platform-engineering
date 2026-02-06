"""Custom tools for the deep agent system.

Provides filesystem utility tools that integrate with the state-based
filesystem used by FilesystemMiddleware.
"""

import asyncio
import logging
from typing import Annotated

from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool, InjectedToolArg
from langgraph.types import Command

try:
    from langgraph.prebuilt.chat_agent_executor import InjectedState
except ImportError:
    from langchain_core.tools import InjectedToolArg as InjectedState

try:
    from langchain_core.tools import InjectedToolCallId
except ImportError:
    InjectedToolCallId = InjectedToolArg

logger = logging.getLogger(__name__)


# Tool names that should be excluded from file path substitution
# These tools expect file paths, not file contents
FS_TOOL_NAMES = {
    "read_file",
    "write_file",
    "ls",
    "glob",
    "grep",
    "edit_file",
    "tool_result_to_file",
}


TOOL_RESULT_TO_FILE_DESCRIPTION = """Writes the content of the most recent tool result in the agent's message history to a file.

Usage:
- The file_path parameter must be an absolute path, not a relative path.
- Provide tool_name to select the most recent result from that specific tool call.
- This tool searches assistant tool calls and matches their corresponding tool results by ID; only results for the named tool are considered.
- Use this after running a tool whose output you want to write to a file (e.g., a subagent's final report or a get/transform tool output).
- Prefer editing existing files over creating new ones when possible.
- Do not call after file system operations.
"""


@tool(description=TOOL_RESULT_TO_FILE_DESCRIPTION)
def tool_result_to_file(
    file_path: str,
    tool_name: str,
    state: Annotated[dict, InjectedState],
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command:
    """
    Write the output of the most recent invocation of `tool_name` to `file_path`.

    The function searches through the message history for assistant messages that
    include tool calls, builds a mapping from `tool_call_id` to `tool_name`, and
    then scans backwards through tool messages to locate the latest result whose
    `tool_call_id` corresponds to the requested `tool_name`.

    If no such result is found, an error string is returned; otherwise the
    content is written into the in-memory filesystem and a confirmation
    ToolMessage is emitted.
    
    Args:
        file_path: Absolute path where the tool output should be written
        tool_name: Name of the tool whose most recent output to write
        state: Injected agent state containing messages and files
        tool_call_id: ID of this tool call for response matching
        
    Returns:
        Command updating files state and emitting confirmation message
    """
    messages = state.get("messages") or []
    files = dict(state.get("files") or {})
    tool_name = tool_name.replace("functions.", "")

    # Build mapping from tool_call_id -> tool name from assistant messages
    call_id_to_name: dict[str, str] = {}
    for msg in messages:
        # Typed AIMessage
        if isinstance(msg, AIMessage) or getattr(msg, "type", None) == "ai":
            tcalls = getattr(msg, "tool_calls", None) or []
        # Dict-style assistant message
        elif isinstance(msg, dict) and msg.get("role") == "assistant":
            tcalls = msg.get("tool_calls") or []
        else:
            tcalls = []

        for call in tcalls:
            # Handle both dict and object-style tool calls
            cid = call.get("id") if isinstance(call, dict) else getattr(call, "id", None)
            name = call.get("name") if isinstance(call, dict) else getattr(call, "name", None)
            if cid and name:
                norm_name = name.replace("functions.", "") if isinstance(name, str) else name
                # Ignore filesystem tool calls
                if norm_name in FS_TOOL_NAMES:
                    continue
                call_id_to_name[cid] = norm_name

    # Find the most recent ToolMessage whose tool_call_id maps to the requested tool_name
    last_tool_content = None
    for msg in reversed(messages):
        # Typed ToolMessage
        if isinstance(msg, ToolMessage) or getattr(msg, "type", None) == "tool":
            tcid = getattr(msg, "tool_call_id", None)
            if tcid and call_id_to_name.get(tcid) == tool_name:
                last_tool_content = getattr(msg, "content", None)
                break
        # Dict-style tool message
        if isinstance(msg, dict) and msg.get("role") == "tool":
            tcid = msg.get("tool_call_id") or msg.get("id")
            if tcid and call_id_to_name.get(tcid) == tool_name:
                last_tool_content = msg.get("content")
                break

    if last_tool_content is None:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"ERROR: No previous tool result found for tool '{tool_name}'",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    # Write to in-memory filesystem
    files[file_path] = last_tool_content
    logger.info(f"tool_result_to_file: wrote {len(last_tool_content)} chars to {file_path}")
    
    return Command(
        update={
            "files": files,
            "messages": [
                ToolMessage(
                    content=f"Updated file {file_path} with {tool_name} output ({len(last_tool_content)} chars)",
                    tool_call_id=tool_call_id,
                )
            ],
        }
    )


WAIT_TOOL_DESCRIPTION = """Pauses execution for a specified number of seconds.

Usage:
- Use this tool when you need to wait before checking status, polling for results, or allowing time for operations to complete.
- The wait is performed asynchronously and does not block other operations.
- Maximum wait time is 300 seconds (5 minutes) per call. For longer waits, call multiple times.
- Common use cases:
  - Waiting for CI/CD status checks to complete
  - Polling for PR merge status
  - Waiting for async operations to finish
"""


@tool(description=WAIT_TOOL_DESCRIPTION)
async def wait(seconds: int) -> str:
    """
    Wait for the specified number of seconds.
    
    Args:
        seconds: Number of seconds to wait (1-300)
        
    Returns:
        Confirmation message with actual wait time
    """
    # Clamp to reasonable bounds
    seconds = max(1, min(seconds, 300))
    
    logger.info(f"wait: sleeping for {seconds} seconds")
    await asyncio.sleep(seconds)
    logger.info(f"wait: completed {seconds} second sleep")
    
    return f"Waited for {seconds} seconds."


__all__ = [
    "tool_result_to_file",
    "wait",
    "FS_TOOL_NAMES",
    "TOOL_RESULT_TO_FILE_DESCRIPTION",
    "WAIT_TOOL_DESCRIPTION",
]
