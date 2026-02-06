"""Custom state classes for the Platform Engineer deep agent.

These state classes extend the official deepagents state with
platform-specific functionality.
"""

from typing import Annotated, Any, Literal, NotRequired
from typing_extensions import TypedDict

try:
    from deepagents.state import AgentState
except ImportError:
    # Fallback to langchain if deepagents not installed
    from langchain.agents.middleware import AgentState


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


def file_reducer(existing: dict[str, str] | None, new: dict[str, str] | None) -> dict[str, str]:
    """Reducer for filesystem state - merges file dictionaries."""
    if existing is None:
        existing = {}
    if new is None:
        return existing
    return {**existing, **new}


class FilesystemState(TypedDict):
    """State for filesystem operations."""
    files: Annotated[dict[str, str], file_reducer]


class PlanningState(AgentState):
    """State for planning phase.
    
    Includes all fields needed by DeterministicTaskMiddleware for workflow execution.
    """
    todos: NotRequired[list[Todo]]
    tasks: NotRequired[list[Task]]
    current_task_id: NotRequired[int]  # Track which task is currently executing
    pending_task_tool_call_id: NotRequired[str]  # Track the task tool call ID
    task_execution_pending: NotRequired[bool]  # Signal for before_model to start task


class DeepAgentState(AgentState):
    """Complete state for the deep agent.
    
    Includes all fields needed by DeterministicTaskMiddleware for workflow execution.
    """
    todos: NotRequired[list[Todo]]
    tasks: NotRequired[list[Task]]
    current_task_id: NotRequired[int]  # Track which task is currently executing
    pending_task_tool_call_id: NotRequired[str]  # Track the task tool call ID
    task_execution_pending: NotRequired[bool]  # Signal for before_model to start task
    files: Annotated[dict[str, str], file_reducer]
