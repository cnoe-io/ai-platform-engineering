"""Middleware for automatic file argument substitution and large output redaction.

This middleware automatically:
1. Replaces file path arguments in tool calls with their contents from the 
   in-memory filesystem, enabling tools to receive file content directly.
2. Redacts large tool arguments and results from conversation history to prevent
   context window overflow and reduce token costs.

The redaction feature is especially important for tools that return large outputs
(like confluence_get_page, gh_cli_execute, etc.) which can consume significant
context window space if left unredacted.
"""

import logging
import os
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage, RemoveMessage
from langgraph.types import Command

try:
    from langchain.agents.middleware.types import AgentMiddleware, AgentState, hook_config, ModelRequest
except ImportError:
    try:
        from langchain.agents.middleware import AgentMiddleware, AgentState, hook_config, ModelRequest
    except ImportError:
        from deepagents.middleware import AgentMiddleware, AgentState, ModelRequest
        # Fallback hook_config if not available
        def hook_config(**kwargs):
            def decorator(func):
                return func
            return decorator

from ai_platform_engineering.utils.deepagents_custom.tools import FS_TOOL_NAMES

logger = logging.getLogger(__name__)


# System prompt addition explaining file argument substitution
CALL_TOOL_WITH_FILE_ARG_SYSTEM_PROMPT = """
## File Argument Substitution

When you call tools with file path arguments that exist in the in-memory filesystem,
the file contents will be automatically substituted for the path. This means:

1. You can pass file paths directly to tools that need file content
2. The middleware will replace the path with the actual content before the tool runs
3. Filesystem tools (read_file, write_file, etc.) are exempt - they receive paths as-is

Example workflow:
1. Use tool_result_to_file to save a tool's output to /tmp/data.json
2. Call another tool with file_path="/tmp/data.json"
3. The middleware substitutes the path with the file content automatically
"""


class CallToolWithFileArgMiddleware(AgentMiddleware):
    """
    Middleware that substitutes file path arguments and redacts large tool outputs.
    
    Features:
    1. File Path Substitution (after_model):
       Any tool-call argument value that matches a file path in the in-memory
       filesystem (state["files"]) will be replaced with the file's contents
       for all non-filesystem tools.
    
    2. Large Output Redaction (modify_model_request):
       Automatically redacts large tool arguments and results from the conversation
       history before sending to the model. This prevents context window overflow
       and reduces token costs.
    
    File substitution enables patterns like:
    1. Save tool output to file: tool_result_to_file(path="/tmp/data.json", tool_name="gh_cli_execute")
    2. Call processing tool: process_data(data="/tmp/data.json")
       -> The middleware replaces "/tmp/data.json" with the actual content
    
    Configurable via environment variables:
    - LAPD_REDACT_THRESHOLD_CHARS: character limit before redaction (default: 10000)
    """

    def __init__(self) -> None:
        super().__init__()
        # Read threshold from env with sane default
        self.max_arg_str_len = int(os.getenv("LAPD_REDACT_THRESHOLD_CHARS", "10000"))

    @staticmethod
    def _replace_fs_content(obj: Any, files: dict[str, str]) -> Any:
        """Recursively replace strings that match file paths in files dict with their contents."""
        if isinstance(obj, str) and obj in files:
            return files[obj]
        if isinstance(obj, list):
            return [CallToolWithFileArgMiddleware._replace_fs_content(x, files) for x in obj]
        if isinstance(obj, dict):
            return {k: CallToolWithFileArgMiddleware._replace_fs_content(v, files) for k, v in obj.items()}
        return obj

    @staticmethod
    def _get_executed_tool_call_ids(messages: list) -> set[str]:
        """Find all tool_call_ids that have corresponding ToolMessage responses (i.e., executed)."""
        executed = set()
        for m in messages:
            if isinstance(m, ToolMessage):
                tid = getattr(m, "tool_call_id", None)
                if tid:
                    executed.add(tid)
        return executed

    @staticmethod
    def _build_tool_name_map(messages: list) -> dict[str, str]:
        """Build mapping from tool_call_id -> tool_name from assistant messages."""
        id_to_name: dict[str, str] = {}
        for msg in messages:
            if isinstance(msg, AIMessage) or getattr(msg, "type", None) == "ai":
                tcalls = getattr(msg, "tool_calls", None) or []
            elif isinstance(msg, dict) and msg.get("role") == "assistant":
                tcalls = msg.get("tool_calls") or []
            else:
                continue
            
            for call in tcalls:
                cid = call.get("id") if isinstance(call, dict) else getattr(call, "id", None)
                name = call.get("name") if isinstance(call, dict) else getattr(call, "name", None)
                if cid and name:
                    id_to_name[cid] = name.replace("functions.", "") if isinstance(name, str) else name
        
        return id_to_name

    def _redact_large_strings_recursive(self, obj: Any) -> tuple[Any, int, int]:
        """Recursively redact large strings. Returns (new_obj, redacted_count, max_redacted_len)."""
        max_arg_str_len = self.max_arg_str_len
        
        if isinstance(obj, str) and len(obj) > max_arg_str_len:
            return f"<redacted {len(obj)} chars>", 1, len(obj)
        
        if isinstance(obj, list):
            out, redacted, max_len = [], 0, 0
            for x in obj:
                nx, rc, ml = self._redact_large_strings_recursive(x)
                out.append(nx)
                redacted += rc
                max_len = max(max_len, ml)
            return out, redacted, max_len
        
        if isinstance(obj, dict):
            out, redacted, max_len = {}, 0, 0
            for k, v in obj.items():
                nv, rc, ml = self._redact_large_strings_recursive(v)
                out[k] = nv
                redacted += rc
                max_len = max(max_len, ml)
            return out, redacted, max_len
        
        return obj, 0, 0

    def _redact_executed_tool_args(
        self, 
        messages: list, 
        executed_tool_call_ids: set[str], 
        target_tools: set[str] | None = None
    ) -> list:
        """Redact large args from executed tool calls.
        
        Args:
            messages: List of messages to process
            executed_tool_call_ids: Set of tool call IDs that have been executed
            target_tools: Optional set of tool names to redact. If None, redacts all tools.
        
        Returns:
            List of messages with large args redacted
        """
        new_msgs = []
        
        for m in messages:
            if isinstance(m, AIMessage) and getattr(m, "tool_calls", None):
                tool_calls = getattr(m, "tool_calls", None) or []
                mutated_any = False
                new_tool_calls = []
                
                for tc in tool_calls:
                    if isinstance(tc, dict):
                        tname, tid, targs = tc.get("name"), tc.get("id"), tc.get("args") or {}
                    else:
                        tname = getattr(tc, "name", None)
                        tid = getattr(tc, "id", None)
                        targs = getattr(tc, "args", {}) or {}

                    # Normalize tool name
                    norm_name = tname.replace("functions.", "") if isinstance(tname, str) else tname
                    
                    # Redact if: executed AND (no target filter OR matches target)
                    should_redact = (
                        isinstance(tid, str) and tid in executed_tool_call_ids
                        and (target_tools is None or (isinstance(norm_name, str) and norm_name in target_tools))
                    )
                    
                    if should_redact:
                        redacted_args, rc, _ = self._redact_large_strings_recursive(targs)
                        if rc > 0:
                            mutated_any = True
                            new_tool_calls.append({"name": tname, "args": redacted_args, "id": tid})
                            logger.debug(f"Redacted large args for tool '{norm_name}' (call_id={tid})")
                        else:
                            new_tool_calls.append(tc)
                    else:
                        new_tool_calls.append(tc)
                
                if mutated_any:
                    new_msgs.append(AIMessage(content=getattr(m, "content", "") or "", tool_calls=new_tool_calls))
                else:
                    new_msgs.append(m)
            else:
                new_msgs.append(m)
        
        return new_msgs

    def _redact_large_tool_results(
        self, 
        messages: list, 
        target_tools: set[str] | None = None,
        require_tool_result_to_file: bool = True
    ) -> list:
        """Redact large ToolMessage contents from conversation history.
        
        Args:
            messages: List of messages to process
            target_tools: Optional set of tool names to redact. If None, redacts all tools.
            require_tool_result_to_file: If True, only redact messages before the last
                tool_result_to_file call (assumes content was saved). If False, redact
                all large results regardless.
        
        Returns:
            List of messages with large tool results redacted
        """
        # Build tool_call_id -> tool_name map
        id_to_tool_name = self._build_tool_name_map(messages)
        
        # Find last tool_result_to_file index (if required)
        last_tool_result_to_file_idx = None
        if require_tool_result_to_file:
            for idx, m in enumerate(messages):
                if isinstance(m, ToolMessage):
                    tid = getattr(m, "tool_call_id", None)
                    if isinstance(tid, str) and id_to_tool_name.get(tid) == "tool_result_to_file":
                        last_tool_result_to_file_idx = idx

            # If require_tool_result_to_file but none found, return unchanged
            if last_tool_result_to_file_idx is None:
                return messages

        newer_msgs = []
        for idx, m in enumerate(messages):
            # Only process ToolMessages before last_tool_result_to_file (if required)
            if isinstance(m, ToolMessage):
                # If we require tool_result_to_file, only redact before that index
                if require_tool_result_to_file and idx >= last_tool_result_to_file_idx:
                    newer_msgs.append(m)
                    continue
                    
                tid = getattr(m, "tool_call_id", None)
                tname = id_to_tool_name.get(tid, None) if isinstance(tid, str) else None
                content = getattr(m, "content", None)
                
                # Redact if: large content AND (no target filter OR matches target)
                should_redact = (
                    isinstance(content, str)
                    and len(content) > self.max_arg_str_len
                    and (target_tools is None or tname in target_tools)
                )
                
                if should_redact:
                    tool_label = tname if tname else "tool"
                    newer_msgs.append(
                        ToolMessage(
                            content=f"<redacted {tool_label} output ({len(content)} chars); re-read from filesystem if needed>",
                            tool_call_id=tid,
                        )
                    )
                    logger.debug(f"Redacted large result from tool '{tname}' ({len(content)} chars)")
                else:
                    newer_msgs.append(m)
            else:
                newer_msgs.append(m)
        
        return newer_msgs

    def modify_model_request(self, request: ModelRequest, agent_state: AgentState) -> ModelRequest:
        """Redact large tool arguments and results before sending to model.
        
        This method runs before each model call and:
        1. Adds the file argument substitution system prompt
        2. Redacts large arguments from already-executed tool calls
        3. Redacts large tool results from conversation history
        
        This prevents context window overflow and reduces token costs when tools
        return or receive large content (e.g., full page content, API responses).
        """
        # Add file arg substitution prompt
        if hasattr(request, 'system_prompt') and request.system_prompt:
            request.system_prompt = request.system_prompt + "\n\n" + CALL_TOOL_WITH_FILE_ARG_SYSTEM_PROMPT
        
        try:
            msgs = getattr(request, "messages", None) or []
            if not msgs:
                return request
            
            # Get all executed tool call IDs
            executed_tool_call_ids = self._get_executed_tool_call_ids(msgs)
            
            # Step 1: Redact large args from ALL executed tool calls
            new_msgs = self._redact_executed_tool_args(
                msgs, 
                executed_tool_call_ids, 
                target_tools=None  # Redact all tools
            )
            
            # Step 2: Redact large tool results (without requiring tool_result_to_file)
            try:
                new_msgs = self._redact_large_tool_results(
                    new_msgs, 
                    target_tools=None,  # Redact all tools
                    require_tool_result_to_file=False  # Don't require file save
                )
            except Exception as e:
                logger.warning(
                    f"[{self.__class__.__name__}] Tool result redaction failed: {e.__class__.__name__}",
                    exc_info=False
                )
            
            request.messages = new_msgs
        except Exception as e:
            logger.warning(
                f"[{self.__class__.__name__}] Tool arg redaction failed: {e.__class__.__name__}",
                exc_info=False
            )
        
        return request

    async def amodify_model_request(self, request: ModelRequest, agent_state: AgentState) -> ModelRequest:
        """Async version of modify_model_request."""
        return self.modify_model_request(request, agent_state)

    def after_model(self, state: AgentState, runtime: Any = None) -> dict[str, Any] | Command | None:
        """
        Inspect the last assistant message. If it contains tool calls with file path args,
        rewrite the AIMessage to replace file paths with their contents.
        
        This allows tools to receive file content directly without needing to read files.
        Filesystem tools (read_file, write_file, etc.) are exempt.
        """
        messages = state.get("messages") or []
        files = state.get("files") or {}
        
        if not messages or not files:
            return None

        # Locate the most recent assistant message (AIMessage or dict-style)
        last_ai = None
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) or (isinstance(msg, dict) and msg.get("role") == "assistant"):
                last_ai = msg
                break
        
        if last_ai is None:
            return None
        
        # Extract tool calls and original content
        if isinstance(last_ai, AIMessage):
            tool_calls = getattr(last_ai, "tool_calls", None) or []
            original_content = getattr(last_ai, "content", "") or ""
        else:
            tool_calls = last_ai.get("tool_calls") or []
            original_content = last_ai.get("content") or ""

        # Gather existing ToolMessage IDs to avoid duplicate processing
        existing_tool_call_ids: set[str] = set()
        try:
            for m in messages:
                if isinstance(m, ToolMessage):
                    tid = getattr(m, "tool_call_id", None)
                    if tid:
                        existing_tool_call_ids.add(tid)
                elif isinstance(m, dict):
                    tid = m.get("tool_call_id")
                    if tid:
                        existing_tool_call_ids.add(tid)
        except Exception:
            pass

        if not tool_calls:
            return None

        mutated = False
        new_tool_calls = []
        
        for call in tool_calls:
            if isinstance(call, dict):
                name = call.get("name")
                args = call.get("args") or {}
                cid = call.get("id")
            else:
                name = getattr(call, "name", None)
                args = getattr(call, "args", {}) or {}
                cid = getattr(call, "id", None)

            # If we already have a ToolMessage acknowledging this call ID, skip mutation
            if cid and cid in existing_tool_call_ids:
                new_tool_calls.append(call)
                continue

            norm_name = name.replace("functions.", "") if name else None

            # Leave filesystem tools unchanged; they expect file paths
            if norm_name in FS_TOOL_NAMES:
                new_tool_calls.append(call)
                continue

            # Replace file paths with file contents
            transformed_args = self._replace_fs_content(args, files)
            if transformed_args != args:
                # Keep the SAME tool_call_id - just transform the args
                new_tool_calls.append(
                    {
                        "name": name,  # Keep original name
                        "args": transformed_args,
                        "id": cid,  # Keep same ID so ToolMessages will match
                    }
                )
                mutated = True
                logger.info(f"CallToolWithFileArgMiddleware: substituted file content for tool '{norm_name}'")
            else:
                new_tool_calls.append(call)

        if not mutated:
            return None

        # Replace AIMessage with transformed args but SAME tool_call_ids
        rewritten = AIMessage(content=original_content, tool_calls=new_tool_calls)
        
        # Remove the original AI message and add the rewritten one
        messages_update = []
        original_id = getattr(last_ai, "id", None) if isinstance(last_ai, AIMessage) else None
        if original_id:
            messages_update.append(RemoveMessage(id=original_id))
        messages_update.append(rewritten)
        
        return Command(update={"messages": messages_update})

    async def aafter_model(self, state: AgentState, runtime: Any = None) -> dict[str, Any] | Command | None:
        """Async version of after_model."""
        return self.after_model(state, runtime)


__all__ = [
    "CallToolWithFileArgMiddleware",
    "CALL_TOOL_WITH_FILE_ARG_SYSTEM_PROMPT",
]
