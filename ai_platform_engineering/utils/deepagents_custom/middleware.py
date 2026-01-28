"""Custom middleware for the Platform Engineer deep agent.

These middleware classes extend the official deepagents middleware with
custom functionality for task orchestration and workflow control.

The pattern follows the marketing agent's approach:
1. QuickActionTasksAnnouncementMiddleware.before_model: Injects task tool call, sets pending_task_tool_call_id
2. SubAgentExecutionMiddleware.before_model: Checks pending_task_tool_call_id, EXECUTES subagent, returns result
3. Model never sees incomplete tool calls because the execution middleware completes them
"""

import json
import logging
import uuid
from typing import Any, cast, NotRequired, Literal

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.types import Command, interrupt
from langgraph.runtime import Runtime
from typing_extensions import TypedDict

# Import Interrupt class for catching HITL interrupts
try:
    from langgraph.errors import GraphInterrupt
except ImportError:
    # Fallback for older versions
    GraphInterrupt = None

try:
    from langchain.agents.middleware import AgentMiddleware, AgentState
except ImportError:
    from deepagents.middleware import AgentMiddleware, AgentState


class Todo(TypedDict):
    """Todo to track."""
    id: int
    content: str
    status: Literal["pending", "in_progress", "completed"]


class Task(TypedDict):
    """Task to execute."""
    id: int
    llm_prompt: str
    display_text: str
    subagent: str


class TaskOrchestrationState(AgentState):
    """State schema for task orchestration middleware."""
    todos: NotRequired[list[Todo]]
    tasks: NotRequired[list[Task]]
    pending_task_tool_call_id: NotRequired[str]


logger = logging.getLogger(__name__)


def _create_write_todos_messages(messages: list, todos: list[Todo]) -> list:
    """Create write_todos tool call messages for the execution plan."""
    result_messages = []
    
    wt_id = f"call_{uuid.uuid4().hex}"
    result_messages.append(AIMessage(
        content="",
        tool_calls=[{
            "name": "write_todos",
            "args": {"todos": todos},
            "id": wt_id,
        }],
    ))
    result_messages.append(ToolMessage(content="", tool_call_id=wt_id))
    return result_messages


def _has_critical_tool_error_in_history(messages: list) -> bool:
    """Check if there's a critical tool error in recent message history.
    
    Scans backwards through messages looking for ToolMessage with error JSON
    containing error_level: "critical". Stops if it finds an AIMessage first
    (meaning the LLM already processed any prior errors).
    
    Returns:
        True if a critical error is found before any AIMessage, False otherwise.
    """
    for m in reversed(messages):
        if isinstance(m, AIMessage):
            return False  # LLM already processed, no pending critical error
        if isinstance(m, ToolMessage) and m.content:
            try:
                parsed = json.loads(m.content)
                if isinstance(parsed, dict) and "error" in parsed:
                    if parsed.get("error_level") == "critical":
                        return True
            except json.JSONDecodeError:
                pass
    return False


class QuickActionTasksAnnouncementMiddleware(AgentMiddleware):
    """Announce the next task via AIMessage tool call without executing it.
    
    This middleware handles the deterministic task execution flow by:
    1. Checking for critical errors that should stop the workflow
    2. Updating todos to mark the current task as in_progress
    3. Creating a task tool call for the next task in the queue
    4. Setting pending_task_tool_call_id so SubAgentExecutionMiddleware executes it
    """
    
    # Declare state schema to extend the agent state with tasks
    state_schema = TaskOrchestrationState

    def before_model(self, state: TaskOrchestrationState):        
        # Clear any one-shot routing override from deterministic loop guard.
        try:
            if isinstance(state, dict):
                state.pop("jump_to", None)
        except Exception:
            pass

        # Don't inject next task if there's a critical error - let workflow stop
        messages = state.get("messages") or []
        if _has_critical_tool_error_in_history(messages):
            logger.info("[QuickActionTasksAnnouncementMiddleware] Critical tool error in history - stopping task announcement")
            return None

        tasks = state.get("tasks") or []
        todos = list(state.get("todos") or [])

        # If there are todos but no tasks, we're done
        if not tasks:
            logger.info("[QuickActionTasksAnnouncementMiddleware] No tasks to announce")
            return None

        # Announce and schedule the next task; mark its todo as in_progress
        task_obj = tasks[0]
        task_id = task_obj.get("id")
        desc = task_obj.get("llm_prompt", "")
        sub = task_obj.get("subagent", "")

        try:
            for i, td in enumerate(todos):
                if isinstance(td, dict) and td.get("id") == task_id and td.get("status") != "completed":
                    todos[i] = {**td, "status": "in_progress"}
                    break
        except Exception:
            pass

        write_todo_msgs = _create_write_todos_messages(messages, todos)

        tool_call_id = f"call_{uuid.uuid4().hex}"
        ai_msg = AIMessage(
            content="",
            tool_calls=[{
                "name": "task",
                "args": {"description": desc, "subagent_type": sub},
                "id": tool_call_id,
            }],
        )

        logger.info(f"[QuickActionTasksAnnouncementMiddleware] Announcing task {task_id}: {sub}")
        
        # Return Command with messages and pending_task_tool_call_id
        # SubAgentExecutionMiddleware will see this and execute the task
        return Command(
            update={
                "messages": write_todo_msgs + [ai_msg],
                "pending_task_tool_call_id": tool_call_id,
                "todos": todos,
            },
        )


class SubAgentExecutionMiddleware(AgentMiddleware):
    """Execute pending task tool calls by invoking subagents.
    
    This middleware runs AFTER QuickActionTasksAnnouncementMiddleware.
    When pending_task_tool_call_id is set, it:
    1. Pops the task from the queue
    2. Invokes the subagent
    3. Returns the ToolMessage result
    
    This ensures the model never sees incomplete tool calls.
    """
    
    state_schema = TaskOrchestrationState
    
    def __init__(self, subagent_graphs: dict[str, Any] | None = None):
        """Initialize with subagent graphs.
        
        Args:
            subagent_graphs: Dict mapping subagent names to their compiled graphs.
                            If None, must be set later via set_subagent_graphs().
        """
        super().__init__()
        self.subagent_graphs = subagent_graphs or {}
    
    def set_subagent_graphs(self, graphs: dict[str, Any]):
        """Set the subagent graphs after initialization."""
        self.subagent_graphs = graphs
    
    def before_model(self, state: TaskOrchestrationState):
        """Execute pending task if one exists (sync wrapper)."""
        import asyncio
        
        messages = state.get("messages") or []
        if not messages:
            return None
        
        # Don't execute if there's a critical error
        if _has_critical_tool_error_in_history(messages):
            logger.info("[SubAgentExecutionMiddleware] Critical tool error in history - stopping")
            return None
        
        tool_call_id = state.get("pending_task_tool_call_id")
        tasks = list(state.get("tasks") or [])
        
        if not tool_call_id:
            return None
        
        task_obj = tasks.pop(0) if tasks else None
        if not task_obj:
            return None
        
        task_id = task_obj.get("id")
        desc = task_obj.get("llm_prompt", "")
        sub = task_obj.get("subagent", "")
        
        logger.info(f"[SubAgentExecutionMiddleware] Executing task {task_id}: {sub} - {desc[:50]}...")
        
        # Execute the subagent
        content = ""
        state_update = {}
        hitl_interrupt = None
        
        if sub in self.subagent_graphs:
            try:
                subagent = self.subagent_graphs[sub]
                # Create fresh state for subagent
                subagent_state = {"messages": [{"role": "user", "content": desc}]}
                subagent_config = {"metadata": {"subagent_type": sub}}
                
                # Use sync invoke - the subagent graphs should support it
                result = subagent.invoke(subagent_state, config=subagent_config)
                
                # Check for HITL interrupt (e.g., from caipe subagent)
                if "__interrupt__" in result:
                    hitl_interrupt = result.get("__interrupt__")
                    logger.info(f"[SubAgentExecutionMiddleware] HITL interrupt from {sub}")
                
                # Extract content from result
                msgs = result.get("messages") or []
                if msgs:
                    last_msg = msgs[-1]
                    content = getattr(last_msg, "content", str(last_msg)) if hasattr(last_msg, "content") else str(last_msg)
                
                # Copy non-message state updates
                for k, v in result.items():
                    if k not in ["todos", "messages", "__interrupt__"]:
                        state_update[k] = v
            
            except Exception as e:
                # Check if this is a GraphInterrupt (HITL)
                error_str = str(e)
                exception_type = type(e).__name__
                logger.info(f"[SubAgentExecutionMiddleware] Exception caught: type={exception_type}, has_value={hasattr(e, 'value')}, has_args={hasattr(e, 'args')}")
                
                if "Interrupt" in exception_type or (GraphInterrupt and isinstance(e, GraphInterrupt)):
                    # Extract interrupt value from exception
                    # The interrupt contains the HITL form data
                    logger.info(f"[SubAgentExecutionMiddleware] HITL interrupt exception from {sub}")
                    
                    # Try to extract interrupt data from exception args
                    interrupt_value = None
                    
                    # Method 1: Direct .value attribute
                    if hasattr(e, 'value'):
                        interrupt_value = e.value
                        logger.info(f"[SubAgentExecutionMiddleware] Extracted via e.value: {type(interrupt_value)}")
                    
                    # Method 2: From e.args
                    if interrupt_value is None and hasattr(e, 'args') and e.args:
                        logger.info(f"[SubAgentExecutionMiddleware] Trying e.args, len={len(e.args)}")
                        first_arg = e.args[0]
                        logger.info(f"[SubAgentExecutionMiddleware] first_arg type={type(first_arg)}")
                        
                        if hasattr(first_arg, 'value'):
                            interrupt_value = first_arg.value
                            logger.info(f"[SubAgentExecutionMiddleware] Extracted via first_arg.value")
                        elif isinstance(first_arg, tuple) and len(first_arg) > 0:
                            # Handle tuple of Interrupt objects
                            first_intr = first_arg[0]
                            logger.info(f"[SubAgentExecutionMiddleware] first_arg is tuple, first_intr type={type(first_intr)}")
                            if hasattr(first_intr, 'value'):
                                interrupt_value = first_intr.value
                                logger.info(f"[SubAgentExecutionMiddleware] Extracted via first_intr.value")
                        elif isinstance(first_arg, dict):
                            # The interrupt value might be the dict directly
                            interrupt_value = first_arg
                            logger.info(f"[SubAgentExecutionMiddleware] first_arg is dict, using directly")
                    
                    if interrupt_value:
                        hitl_interrupt = interrupt_value
                        if isinstance(interrupt_value, dict):
                            logger.info(f"[SubAgentExecutionMiddleware] Extracted HITL data keys: {list(interrupt_value.keys())}")
                            if 'action_requests' in interrupt_value:
                                logger.info(f"[SubAgentExecutionMiddleware] action_requests count: {len(interrupt_value.get('action_requests', []))}")
                        else:
                            logger.info(f"[SubAgentExecutionMiddleware] Extracted HITL data type: {type(interrupt_value)}")
                    else:
                        # Still treat as interrupt but log warning
                        logger.warning(f"[SubAgentExecutionMiddleware] HITL interrupt but couldn't extract value. Exception: {e}, args: {e.args if hasattr(e, 'args') else 'no args'}")
                        hitl_interrupt = {"action_requests": [], "review_configs": []}
                else:
                    logger.error(f"[SubAgentExecutionMiddleware] Subagent {sub} failed: {e}")
                    content = f"Error executing subagent {sub}: {str(e)}"
        else:
            content = f"Subagent '{sub}' not found. Available: {list(self.subagent_graphs.keys())}"
            logger.warning(f"[SubAgentExecutionMiddleware] {content}")
        
        # If there's an HITL interrupt, propagate it by re-raising at parent level
        if hitl_interrupt:
            # Don't mark task as completed yet - keep it pending
            # Put the task back in the queue
            tasks.insert(0, task_obj)
            
            # Log the interrupt data for debugging
            logger.info(f"[SubAgentExecutionMiddleware] Propagating HITL interrupt to parent graph")
            
            # Re-raise the interrupt at the parent level so it gets yielded in the stream
            # This will cause the parent graph to pause and yield the interrupt event
            raise interrupt(hitl_interrupt)
        
        # Create tool result message
        tm = ToolMessage(content=content, tool_call_id=tool_call_id)
        
        # Mark todo as completed
        todos = list(state.get("todos") or [])
        for i, td in enumerate(todos):
            if isinstance(td, dict) and td.get("id") == task_id:
                todos[i] = {**td, "status": "completed"}
                break
        
        update = {
            "messages": [tm, AIMessage(content="\n")],
            "tasks": tasks,
            "todos": todos,
            "pending_task_tool_call_id": None,
        }
        update.update(state_update)
        
        logger.info(f"[SubAgentExecutionMiddleware] Task {task_id} completed, {len(tasks)} remaining")
        return Command(update=update)


class DeterministicTaskLoopGuardMiddleware(AgentMiddleware):
    """
    Loop guard: if deterministic tasks remain, prevent the run from
    ending just because the model emitted a plain AIMessage (no tool calls).

    This middleware ensures the agent continues processing the task queue
    even if the LLM occasionally outputs a plain message without tool calls.
    """
    
    # Declare state schema to extend the agent state with tasks
    state_schema = TaskOrchestrationState

    def after_model(self, state: TaskOrchestrationState, runtime: Runtime) -> Command | None:
        try:
            tasks = cast(list[dict], state.get("tasks") or [])
            if not tasks:
                return None

            # Don't interfere while a deterministic task tool call is in-flight
            if state.get("pending_task_tool_call_id"):
                return None

            # Don't interfere with HITL/pauses
            if state.get("__interrupt__"):
                return None

            messages = state.get("messages") or []
            
            # Don't force loop if there's a critical error - let workflow stop
            if _has_critical_tool_error_in_history(messages):
                logger.info("[DeterministicTaskLoopGuardMiddleware] Critical tool error detected - stopping workflow")
                return None

            last_ai: AIMessage | None = None
            for m in reversed(messages):
                if isinstance(m, AIMessage):
                    last_ai = m
                    break
            if last_ai is None:
                return None

            tool_calls = getattr(last_ai, "tool_calls", None) or []
            if len(tool_calls) == 0:
                # Force routing back to the before_model chain
                logger.info("[DeterministicTaskLoopGuardMiddleware] Force routing back to before_model")
                return Command(update={"jump_to": "model"})
        except Exception:
            return None

        return None
