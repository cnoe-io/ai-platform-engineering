# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Custom middleware for deterministic task execution in the Platform Engineer deep agent.

This module provides middleware that executes self-service workflows from 
task_config.yaml in a deterministic sequence using wrap_tool_call.

The key insight: wrap_tool_call runs AROUND each tool execution, so we can:
1. Intercept the `task` tool call
2. Execute it (call handler)  
3. After it returns, check if there are more tasks
4. If yes, return a Command that chains to the next task WITHOUT going back to model

This creates a loop WITHIN the tools node, avoiding LLM validation errors.

Flow:
1. invoke_self_service_task populates tasks/todos and injects first task call
2. wrap_tool_call intercepts task execution
3. After task completes, wrap_tool_call returns Command with next task call
4. Repeat until all tasks done
5. Return to model for final response
"""

import logging
import uuid
from typing import Any, Awaitable, Callable, Literal, NotRequired

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from typing_extensions import TypedDict

from langchain.agents.middleware.types import AgentMiddleware, AgentState, hook_config
from langgraph.errors import GraphInterrupt
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command

logger = logging.getLogger(__name__)

# Import self_service_mode helper for policy authorization
# This allows PolicyMiddleware to know when write operations should be allowed
try:
    from ai_platform_engineering.agents.github.agent_github.tools import (
        set_self_service_mode,
        is_self_service_mode,
        set_task_allowed_tools,
    )
except ImportError:
    _self_service_mode_fallback = False

    def set_self_service_mode(value: bool) -> None:
        global _self_service_mode_fallback
        _self_service_mode_fallback = value

    def is_self_service_mode() -> bool:
        return _self_service_mode_fallback

    def set_task_allowed_tools(tools) -> None:
        pass


class Todo(TypedDict):
    """Todo item for execution plan tracking."""
    id: int
    content: str
    status: Literal["pending", "in_progress", "completed"]


class Task(TypedDict):
    """Task to execute via subagent."""
    id: int
    llm_prompt: str
    display_text: str
    subagent: str


class TaskOrchestrationState(AgentState):
    """State schema for task orchestration middleware."""
    todos: NotRequired[list[Todo]]
    tasks: NotRequired[list[Task]]
    current_task_id: NotRequired[int]
    pending_task_tool_call_id: NotRequired[str]  # Track the task tool call we're waiting for
    task_execution_pending: NotRequired[bool]  # Signal for before_model to start execution
    user_email: NotRequired[str]  # Authenticated user's email from OIDC token
    user_name: NotRequired[str]
    user_groups: NotRequired[list[str]]


def _generate_tool_call_id() -> str:
    """Generate a unique tool call ID."""
    return f"call_{uuid.uuid4().hex[:24]}"


class DeterministicTaskMiddleware(AgentMiddleware):
    """Middleware for deterministic task execution using before_model + wrap_tool_call.
    
    This middleware has two parts:
    
    1. before_model: When task_execution_pending is True:
       - Injects AIMessage with task tool_call
       - Jumps to "tools" node, SHORT-CIRCUITING the model call
       - The model never sees incomplete tool_use/tool_result pairs
    
    2. wrap_tool_call: When `task` tool is called with matching pending_task_tool_call_id:
       - Execute the task (call handler)
       - Mark current task as completed
       - If more tasks remain, return Command with next task call -> loops in tools
       - If no more tasks, return normal result -> goes back to model
    
    The key insight: before_model's jump_to prevents the model from being called,
    so it never sees the incomplete tool sequence.
    """
    
    state_schema = TaskOrchestrationState
    
    @staticmethod
    def _extract_user_request(state: TaskOrchestrationState) -> str | None:
        """Extract the last human message before the workflow was invoked.

        Walks messages in reverse to find the most recent HumanMessage,
        which is the user's original request that triggered the workflow.
        """
        messages = state.get("messages") or []
        for msg in reversed(messages):
            if isinstance(msg, HumanMessage) and isinstance(msg.content, str) and msg.content.strip():
                return msg.content.strip()
        return None

    def _build_task_injection(self, state: TaskOrchestrationState) -> dict[str, Any] | None:
        """Build the state update to inject task execution.
        
        Shared logic for both sync and async before_model hooks.
        """
        task_pending = state.get("task_execution_pending", False)
        tasks = state.get("tasks") or []

        # Idle-path no-op: every model turn passes through this hook even when no
        # Quick Action workflow is active. Demoted to DEBUG so production logs
        # aren't dominated by per-turn middleware tracing for skills/regular chat.
        if not task_pending or not tasks:
            logger.debug(
                "[DeterministicTaskMiddleware] before_model: no pending tasks, "
                "passing through (task_pending=%s, tasks=%d)",
                task_pending,
                len(tasks),
            )
            return None

        # An actual deterministic task is about to be injected; this IS interesting.
        state_keys = list(state.keys()) if hasattr(state, "keys") else "N/A"
        logger.info(
            "[DeterministicTaskMiddleware] before_model: task_pending=%s, tasks_count=%d, state_keys=%s",
            task_pending,
            len(tasks),
            state_keys,
        )
        
        # Get next task
        task = tasks[0]
        task_id = task.get("id")
        llm_prompt = task.get("llm_prompt", "")
        subagent = task.get("subagent", "general-purpose")
        display_text = task.get("display_text", f"Step {task_id}")
        
        # Inject the user's original request so subagents can extract
        # values the user already provided (e.g., emails, group names)
        user_request = self._extract_user_request(state)
        if user_request:
            llm_prompt = (
                llm_prompt
                + f"\n\n[USER REQUEST] The user's original message was: \"{user_request}\"\n"
                f"Extract any values already provided and use them as default_value on form fields."
            )
            logger.info(f"[DeterministicTaskMiddleware] Injected user request into task {task_id} prompt")

        # Inject authenticated user email context into task prompts
        user_email = state.get("user_email", "")
        if user_email:
            user_context = (
                f"\n\n[USER CONTEXT] The authenticated user's email is: {user_email}\n"
                f"Pre-fill any user_email or requested_by fields with this value. "
                f"Do NOT ask the user for their email — use {user_email} automatically."
            )
            llm_prompt = llm_prompt + user_context
            logger.info(f"[DeterministicTaskMiddleware] Injected user_email={user_email} into task {task_id} prompt")
        
        logger.info(f"[DeterministicTaskMiddleware] before_model: Starting task {task_id}: {display_text}")
        
        # Update todos - mark this task as in_progress
        todos = list(state.get("todos") or [])
        for i, todo in enumerate(todos):
            if isinstance(todo, dict) and todo.get("id") == task_id:
                todos[i] = {**todo, "status": "in_progress"}
                break
        
        # Generate tool call IDs
        write_todos_id = _generate_tool_call_id()
        task_tool_id = _generate_tool_call_id()
        
        # Build complete message sequence:
        # 1. write_todos (complete pair - AIMessage + ToolMessage)
        # 2. task (AIMessage only - will be executed by tools node)
        injected_messages = [
            AIMessage(content="", tool_calls=[{
                "name": "write_todos",
                "args": {"todos": todos},
                "id": write_todos_id,
            }]),
            ToolMessage(
                content=f"Starting: {display_text}",
                name="write_todos",
                tool_call_id=write_todos_id,
            ),
            AIMessage(content="", tool_calls=[{
                "name": "task",
                "args": {"description": llm_prompt, "subagent_type": subagent},
                "id": task_tool_id,
            }]),
        ]
        
        logger.info(f"[DeterministicTaskMiddleware] before_model: Injecting task call, jumping to tools (task_tool_id={task_tool_id})")
        
        # Return update with jump_to - this SHORT-CIRCUITS the model call
        return {
            "messages": injected_messages,
            "todos": todos,
            "current_task_id": task_id,
            "pending_task_tool_call_id": task_tool_id,
            "task_execution_pending": False,  # Clear the flag
            "jump_to": "tools",  # CRITICAL: Skip model, go directly to tools
        }
    
    @hook_config(can_jump_to=["tools", "end"])
    def before_model(self, state: TaskOrchestrationState, runtime: Any = None) -> dict[str, Any] | None:
        """Short-circuit model when tasks are pending (sync version)."""
        return self._build_task_injection(state)
    
    @hook_config(can_jump_to=["tools", "end"])
    async def abefore_model(self, state: TaskOrchestrationState, runtime: Any = None) -> dict[str, Any] | None:
        """Short-circuit model when tasks are pending (async version).
        
        When task_execution_pending is True:
        1. Get the first task from the queue
        2. Mark its todo as in_progress
        3. Inject write_todos (complete pair) + AIMessage with task tool_call
        4. Jump to "tools" - MODEL IS NEVER CALLED
        
        This avoids LLM validation errors because the model never sees
        the incomplete tool_use/tool_result sequence.
        """
        return self._build_task_injection(state)
    
    @hook_config(can_jump_to=["end"])
    def after_model(self, state: TaskOrchestrationState, runtime: Any = None) -> dict[str, Any] | None:
        """Detect redundant write_todos calls and terminate the graph loop.

        When the model calls write_todos with all tasks completed and the state
        already has all tasks completed, this is a redundant call that would
        otherwise cause an infinite loop (model → tools → model → ...).

        This hook injects ToolMessages to satisfy the pending tool calls and
        sets jump_to="end" to exit the graph cleanly.

        Works for both deterministic task config workflows and regular
        invocations where the model redundantly updates completed todos.
        """
        messages = state.get("messages", [])
        if not messages:
            return None

        last_ai_msg = None
        for msg in reversed(messages):
            if isinstance(msg, AIMessage):
                last_ai_msg = msg
                break

        if not last_ai_msg or not last_ai_msg.tool_calls:
            return None

        write_todos_calls = [tc for tc in last_ai_msg.tool_calls if tc["name"] == "write_todos"]
        if not write_todos_calls or len(write_todos_calls) != len(last_ai_msg.tool_calls):
            # Detect RAG loop: model keeps calling a RAG tool whose cap is already exhausted.
            # Only terminate when ALL tool calls target individually-capped tools.
            # This allows e.g. fetch_document to proceed even if search is capped.
            try:
                from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import is_rag_hard_stopped, is_rag_tool_capped  # noqa: PLC0415
                from langgraph.config import get_config  # noqa: PLC0415

                # Extract thread_id from LangGraph config to track RAG cap state per conversation
                cfg = get_config()
                thread_id = cfg.get("configurable", {}).get("thread_id", "__default__") if cfg else "__default__"

                # Check if any RAG tool has exhausted its budget (hard-stop flag is set)
                if is_rag_hard_stopped(thread_id):
                    rag_tool_names = {"fetch_document", "search"}
                    # Filter to only RAG tool calls from this model invocation
                    rag_calls = [tc for tc in last_ai_msg.tool_calls if tc["name"] in rag_tool_names]
                    # True if the model is ONLY calling RAG tools (no mixed tool calls)
                    all_calls_are_rag = rag_calls and len(rag_calls) == len(last_ai_msg.tool_calls)

                    # Debug log: show which tools are capped to help diagnose RAG loop scenarios
                    capped_tools = [tc["name"] for tc in rag_calls if is_rag_tool_capped(thread_id, tc["name"])]
                    logger.debug(f"[DeterministicTaskMiddleware] RAG hard-stop active: all_calls_are_rag={all_calls_are_rag}, capped_tools={capped_tools}")

                    # True if all RAG calls target tools with individually exhausted caps
                    # (search capped but fetch_document not capped would return False here)
                    all_individually_capped = all_calls_are_rag and all(
                        is_rag_tool_capped(thread_id, tc["name"]) for tc in rag_calls
                    )

                    if all_individually_capped:
                        # Model is stuck in an infinite loop trying to call a capped tool.
                        # Inject a synthesis prompt to let the LLM work with what it already has,
                        # then return to the model (NOT jump_to: "end") so it gets one more turn.
                        logger.info(
                            f"[DeterministicTaskMiddleware] RAG loop detected "
                            f"(caps exhausted, still calling {[tc['name'] for tc in rag_calls]}), "
                            f"allowing LLM one more turn to synthesize response"
                        )
                        tool_messages = [
                            ToolMessage(
                                content="RAG budget exhausted. Synthesize your answer from what was already retrieved.",
                                tool_call_id=tc["id"],
                                name=tc["name"],
                            )
                            for tc in rag_calls
                        ]
                        # Return tool responses WITHOUT jump_to so the LLM gets a turn to synthesize
                        return {"messages": tool_messages}
            except Exception as rag_err:
                # Log full traceback in case RAG checking is broken in a new way
                logger.warning(f"[DeterministicTaskMiddleware] RAG hard-stop check failed: {rag_err}", exc_info=True)
            return None

        for tc in write_todos_calls:
            new_todos = tc.get("args", {}).get("todos", [])
            if not new_todos or not all(t.get("status") == "completed" for t in new_todos):
                return None

        current_todos = state.get("todos") or []
        if not current_todos or not all(t.get("status") == "completed" for t in current_todos):
            return None

        # In structured response mode, the LLM still needs to call the
        # ResponseFormat tool after all tasks complete.  Jumping to "end"
        # would skip that final tool call and produce a blank response.
        # Instead, just inject ToolMessages so the model knows the todos
        # are done and can proceed to generate the structured response.
        from ai_platform_engineering.multi_agents.platform_engineer.deep_agent import USE_STRUCTURED_RESPONSE

        tool_messages = [
            ToolMessage(
                content="All tasks already completed.",
                tool_call_id=tc["id"],
                name="write_todos",
            )
            for tc in write_todos_calls
        ]

        if USE_STRUCTURED_RESPONSE:
            logger.info("[DeterministicTaskMiddleware] Redundant write_todos detected (all completed), continuing for structured response")
            return {"messages": tool_messages}
        else:
            logger.info("[DeterministicTaskMiddleware] Redundant write_todos detected (all completed), terminating loop")
            return {"messages": tool_messages, "jump_to": "end"}

    @hook_config(can_jump_to=["end"])
    async def aafter_model(self, state: TaskOrchestrationState, runtime: Any = None) -> dict[str, Any] | None:
        """Async version of after_model."""
        return self.after_model(state, runtime)

    def _handle_task_completion(
        self,
        tool_call_id: str,
        current_task_id: int,
        tasks: list,
        todos_input: list,
        tool_msg_content: str,
        files_state: dict | None = None,
    ) -> Command:
        """Shared logic for handling task completion and chaining.
        
        This is used by both sync and async wrap_tool_call methods.
        
        IMPORTANT: We do NOT inject the next task's AIMessage here.
        Instead, we set task_execution_pending=True and let abefore_model
        handle the injection with proper jump_to: "tools" short-circuit.
        
        This avoids the ValidationException because the model is never called.
        
        Args:
            files_state: The 'files' dict from the completed task's Command.
                         This must be propagated to maintain filesystem state
                         between subagent calls.
        """
        # Update todos - mark current as completed
        todos = list(todos_input)
        for i, todo in enumerate(todos):
            if isinstance(todo, dict) and todo.get("id") == current_task_id:
                todos[i] = {**todo, "status": "completed"}
                break
        
        # Remove completed task from queue
        remaining_tasks = [t for t in tasks if t.get("id") != current_task_id]
        
        logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} completed, {len(remaining_tasks)} remaining")
        if files_state:
            logger.info(f"[DeterministicTaskMiddleware] Propagating {len(files_state)} files to next task")
        
        # Build write_todos update for completion
        write_todos_id = _generate_tool_call_id()
        
        if remaining_tasks:
            # More tasks remain - set flag for abefore_model to continue
            next_task = remaining_tasks[0]
            next_display = next_task.get("display_text", f"Step {next_task.get('id')}")
            
            logger.info(f"[DeterministicTaskMiddleware] Setting task_execution_pending for next task: {next_display}")
            
            # Build COMPLETE messages only (no dangling AIMessage with task call)
            # The next task call will be injected by abefore_model
            completion_messages = [
                ToolMessage(content=tool_msg_content, name="task", tool_call_id=tool_call_id),
                AIMessage(content="", tool_calls=[{
                    "name": "write_todos",
                    "args": {"todos": todos},
                    "id": write_todos_id,
                }]),
                ToolMessage(content=f"Task {current_task_id} completed. Continuing to next step.", name="write_todos", tool_call_id=write_todos_id),
            ]
            
            # Build update dict - CRITICAL: Include files state for filesystem sharing!
            update_dict = {
                "messages": completion_messages,
                "todos": todos,
                "tasks": remaining_tasks,
                "current_task_id": None,  # Clear - abefore_model will set it
                "pending_task_tool_call_id": None,  # Clear - abefore_model will set it
                "task_execution_pending": True,  # Signal for abefore_model
            }
            
            # Propagate files state to maintain filesystem between subagents
            if files_state:
                update_dict["files"] = files_state
            
            # Return Command that sets task_execution_pending
            # Flow: tools -> model -> abefore_model sees flag -> jump_to: "tools"
            return Command(update=update_dict)
        else:
            # All tasks done - return to model for final response
            logger.info("[DeterministicTaskMiddleware] All tasks completed, returning to model")
            
            completion_messages = [
                ToolMessage(content=tool_msg_content, name="task", tool_call_id=tool_call_id),
                AIMessage(content="", tool_calls=[{
                    "name": "write_todos",
                    "args": {"todos": todos},
                    "id": write_todos_id,
                }]),
                ToolMessage(content="All workflow tasks completed successfully.", name="write_todos", tool_call_id=write_todos_id),
            ]
            
            # Build update dict - include files for final state
            update_dict = {
                "messages": completion_messages,
                "todos": todos,
                "tasks": [],
                "current_task_id": None,
                "pending_task_tool_call_id": None,
                "task_execution_pending": False,
                "task_allowed_tools": None,
            }
            
            if files_state:
                update_dict["files"] = files_state
            
            return Command(update=update_dict)
    
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        """Intercept task tool to chain deterministic execution (sync version)."""
        tool_name = request.tool_call.get("name", "")
        tool_call_id = request.tool_call.get("id", "")
        state = request.state or {}
        
        # Check if this is our deterministic task execution
        pending_id = state.get("pending_task_tool_call_id")
        tasks = state.get("tasks") or []
        current_task_id = state.get("current_task_id")
        
        if tool_name == "task" and pending_id and tool_call_id == pending_id:
            logger.info(f"[DeterministicTaskMiddleware] Executing task {current_task_id} via wrap_tool_call (sync)")
            
            set_self_service_mode(True)
            task_tools = state.get("task_allowed_tools")
            set_task_allowed_tools(task_tools)
            logger.info(f"[DeterministicTaskMiddleware] Enabled self_service_mode=True for task {current_task_id}")
            
            task_failed = False
            tool_msg_content = "Task completed."
            try:
                result = handler(request)
            except Exception as exc:
                if isinstance(exc, GraphInterrupt):
                    raise
                logger.error(f"[DeterministicTaskMiddleware] Task {current_task_id} raised exception: {exc}")
                task_failed = True
                tool_msg_content = f"Task failed with error: {exc}"
                result = None
            finally:
                set_self_service_mode(False)
                set_task_allowed_tools(None)
                logger.debug(f"[DeterministicTaskMiddleware] Disabled self_service_mode after task {current_task_id}")
            
            # Extract the ToolMessage content and files state
            files_state = None
            if not task_failed:
                if isinstance(result, Command):
                    update = result.update or {}
                    files_state = update.get("files")
                    tool_msg_content = "Task completed."
                elif isinstance(result, ToolMessage):
                    tool_msg_content = result.content
                else:
                    tool_msg_content = str(result)
            
            # Merge with existing files state
            existing_files = state.get("files") or {}
            if files_state:
                merged_files = {**existing_files, **files_state}
            else:
                merged_files = existing_files if existing_files else None
            
            return self._handle_task_completion(
                tool_call_id=tool_call_id,
                current_task_id=current_task_id,
                tasks=tasks,
                todos_input=state.get("todos") or [],
                tool_msg_content=tool_msg_content,
                files_state=merged_files,
            )
        
        # For all other tools, pass through normally
        return handler(request)
    
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        """Intercept task tool to chain deterministic execution (async version).
        
        When the `task` tool is called and matches our pending_task_tool_call_id:
        1. Execute the task (await handler)
        2. After completion, mark todo as completed and chain to next task
        3. If handler raises, catch the error, pass it as tool result, and continue
        """
        tool_name = request.tool_call.get("name", "")
        tool_call_id = request.tool_call.get("id", "")
        state = request.state or {}
        
        # Check if this is our deterministic task execution
        pending_id = state.get("pending_task_tool_call_id")
        tasks = state.get("tasks") or []
        current_task_id = state.get("current_task_id")
        
        if tool_name == "task" and pending_id and tool_call_id == pending_id:
            # Log the task details being executed
            task_args = request.tool_call.get("args", {})
            subagent_type = task_args.get("subagent_type", "unknown")
            description = task_args.get("description", "")[:100]
            logger.info(f"[DeterministicTaskMiddleware] Executing task {current_task_id} via awrap_tool_call: subagent={subagent_type}, desc={description}...")
            
            set_self_service_mode(True)
            task_tools = state.get("task_allowed_tools")
            set_task_allowed_tools(task_tools)
            logger.info(f"[DeterministicTaskMiddleware] Enabled self_service_mode=True for task {current_task_id}")
            
            task_failed = False
            tool_msg_content = "Task completed."
            try:
                result = await handler(request)
            except Exception as exc:
                if isinstance(exc, GraphInterrupt):
                    raise
                logger.error(f"[DeterministicTaskMiddleware] Task {current_task_id} raised exception: {exc}")
                task_failed = True
                tool_msg_content = f"Task failed with error: {exc}"
                result = None
            finally:
                set_self_service_mode(False)
                set_task_allowed_tools(None)
                logger.debug(f"[DeterministicTaskMiddleware] Disabled self_service_mode after task {current_task_id}")
            
            # Log the result type and content
            if result is not None:
                logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} handler returned: type={type(result).__name__}")
            
            # Extract the ToolMessage content and files state
            files_state = None
            if not task_failed:
                if isinstance(result, Command):
                    update = result.update or {}
                    update_msgs = update.get("messages", [])
                    files_state = update.get("files")
                    
                    logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} Command: {len(update_msgs)} messages, goto={result.goto}")
                    
                    for i, msg in enumerate(update_msgs):
                        msg_type = type(msg).__name__
                        if hasattr(msg, 'content'):
                            content_preview = str(msg.content)[:150] if msg.content else "(empty)"
                        else:
                            content_preview = str(msg)[:150]
                        logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} Command msg[{i}]: {msg_type} - {content_preview}")
                    
                    other_keys = [k for k in update.keys() if k != "messages"]
                    if other_keys:
                        logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} Command update keys: {other_keys}")
                    if files_state:
                        logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} has {len(files_state)} files to propagate")
                    
                    if update_msgs:
                        last_msg = update_msgs[-1]
                        if hasattr(last_msg, 'content') and last_msg.content:
                            tool_msg_content = str(last_msg.content)
                        else:
                            tool_msg_content = "Task completed."
                    else:
                        tool_msg_content = "Task completed."
                elif isinstance(result, ToolMessage):
                    tool_msg_content = result.content
                    logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} ToolMessage: {tool_msg_content[:200] if tool_msg_content else 'empty'}...")
                else:
                    tool_msg_content = str(result)
                    logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} other: {tool_msg_content[:200]}...")
            
            # Merge with existing files state from current state
            existing_files = state.get("files") or {}
            if files_state:
                merged_files = {**existing_files, **files_state}
                logger.info(f"[DeterministicTaskMiddleware] Merged files: {len(existing_files)} existing + {len(files_state)} new = {len(merged_files)} total")
            else:
                merged_files = existing_files if existing_files else None
            
            return self._handle_task_completion(
                tool_call_id=tool_call_id,
                current_task_id=current_task_id,
                tasks=tasks,
                todos_input=state.get("todos") or [],
                tool_msg_content=tool_msg_content,
                files_state=merged_files,
            )
        
        # For all other tools, pass through normally
        return await handler(request)


# Legacy aliases
QuickActionTasksAnnouncementMiddleware = DeterministicTaskMiddleware
SubAgentExecutionMiddleware = DeterministicTaskMiddleware


__all__ = [
    "DeterministicTaskMiddleware",
    "TaskOrchestrationState",
    "Todo",
    "Task",
    "QuickActionTasksAnnouncementMiddleware",
    "SubAgentExecutionMiddleware",
]
