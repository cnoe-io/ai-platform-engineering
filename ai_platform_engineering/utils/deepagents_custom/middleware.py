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

import json
import logging
import uuid
from typing import Any, Awaitable, Callable, Literal, NotRequired

from langchain_core.messages import AIMessage, ToolMessage
from typing_extensions import TypedDict

try:
    from langchain.agents.middleware.types import AgentMiddleware, AgentState, hook_config
    from langgraph.prebuilt.tool_node import ToolCallRequest
    from langgraph.types import Command
except ImportError:
    try:
        from langchain.agents.middleware import AgentMiddleware, AgentState, hook_config
        from langgraph.prebuilt.tool_node import ToolCallRequest
        from langgraph.types import Command
    except ImportError:
        from deepagents.middleware import AgentMiddleware, AgentState
        from langgraph.types import Command
        ToolCallRequest = Any
        
        def hook_config(**kwargs):
            """Decorator stub for hook configuration."""
            def decorator(func):
                func._hook_config = kwargs
                func.__can_jump_to__ = kwargs.get("can_jump_to", [])
                return func
            return decorator

logger = logging.getLogger(__name__)


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
    
    def _build_task_injection(self, state: TaskOrchestrationState) -> dict[str, Any] | None:
        """Build the state update to inject task execution.
        
        Shared logic for both sync and async before_model hooks.
        """
        task_pending = state.get("task_execution_pending", False)
        tasks = state.get("tasks") or []
        
        logger.debug(f"[DeterministicTaskMiddleware] before_model: task_pending={task_pending}, tasks_count={len(tasks)}")
        
        if not task_pending or not tasks:
            logger.debug("[DeterministicTaskMiddleware] before_model: No pending tasks, passing through")
            return None
        
        # Get next task
        task = tasks[0]
        task_id = task.get("id")
        llm_prompt = task.get("llm_prompt", "")
        subagent = task.get("subagent", "general-purpose")
        display_text = task.get("display_text", f"Step {task_id}")
        
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
                ToolMessage(content=tool_msg_content, tool_call_id=tool_call_id),
                AIMessage(content="", tool_calls=[{
                    "name": "write_todos",
                    "args": {"todos": todos},
                    "id": write_todos_id,
                }]),
                ToolMessage(content=f"Task {current_task_id} completed. Continuing to next step.", tool_call_id=write_todos_id),
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
                ToolMessage(content=tool_msg_content, tool_call_id=tool_call_id),
                AIMessage(content="", tool_calls=[{
                    "name": "write_todos",
                    "args": {"todos": todos},
                    "id": write_todos_id,
                }]),
                ToolMessage(content="All workflow tasks completed successfully.", tool_call_id=write_todos_id),
            ]
            
            # Build update dict - include files for final state
            update_dict = {
                "messages": completion_messages,
                "todos": todos,
                "tasks": [],
                "current_task_id": None,
                "pending_task_tool_call_id": None,
                "task_execution_pending": False,
            }
            
            # Include final files state
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
            
            # Execute the task
            result = handler(request)
            
            # Extract the ToolMessage content and files state
            files_state = None
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
        2. After completion, mark todo as completed
        3. If more tasks remain, return Command that chains to next task
        4. Otherwise return the result normally
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
            
            # Execute the task asynchronously
            result = await handler(request)
            
            # Log the result type and content
            logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} handler returned: type={type(result).__name__}")
            
            # Extract the ToolMessage content and files state
            files_state = None
            if isinstance(result, Command):
                # Command might have messages and files in its update
                update = result.update or {}
                update_msgs = update.get("messages", [])
                files_state = update.get("files")  # CRITICAL: Extract files state!
                
                logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} Command: {len(update_msgs)} messages, goto={result.goto}")
                
                # Log each message in the update
                for i, msg in enumerate(update_msgs):
                    msg_type = type(msg).__name__
                    if hasattr(msg, 'content'):
                        content_preview = str(msg.content)[:150] if msg.content else "(empty)"
                    else:
                        content_preview = str(msg)[:150]
                    logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} Command msg[{i}]: {msg_type} - {content_preview}")
                
                # Log other update keys including files
                other_keys = [k for k in update.keys() if k != "messages"]
                if other_keys:
                    logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} Command update keys: {other_keys}")
                if files_state:
                    logger.info(f"[DeterministicTaskMiddleware] Task {current_task_id} has {len(files_state)} files to propagate")
                
                # Try to extract content from the last message
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
            
            # Also merge with existing files state from current state
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
