"""Custom deepagents utilities for the AI Platform Engineering project.

This module provides custom middleware, state classes, and utilities that extend
the official deepagents package with platform-specific functionality.

The official deepagents package (>=0.3.8) provides:
- create_deep_agent
- TodoListMiddleware, FilesystemMiddleware, SubAgentMiddleware
- Built-in filesystem and planning tools

This custom module provides:
- QuickActionTasksAnnouncementMiddleware - Task orchestration for self-service workflows
- DeterministicTaskLoopGuardMiddleware - Ensures task queue is fully processed
- Thread-scoped filesystem (FS, set_current_thread_id)
- Custom state classes (DeepAgentState, Todo, Task)
"""

# Re-export official deepagents components
from deepagents import create_deep_agent

# Export custom middleware
from ai_platform_engineering.utils.deepagents_custom.middleware import (
    QuickActionTasksAnnouncementMiddleware,
    SubAgentExecutionMiddleware,
    DeterministicTaskLoopGuardMiddleware,
    TaskOrchestrationState,
)

# Export custom state classes
from ai_platform_engineering.utils.deepagents_custom.state import (
    DeepAgentState,
    PlanningState,
    FilesystemState,
    Todo,
    Task,
    file_reducer,
)

# Export filesystem utilities
from ai_platform_engineering.utils.deepagents_custom.fs import (
    FS,
    FS_LOCK,
    set_current_thread_id,
    get_current_thread_id,
    dump_filesystem,
    load_filesystem,
    clear_thread_files,
    fs_context,
)

# Export exceptions
from ai_platform_engineering.utils.deepagents_custom.exceptions import (
    AgentStopRequestedError,
    ToolError,
)

__all__ = [
    # Official deepagents
    "create_deep_agent",
    # Custom middleware
    "QuickActionTasksAnnouncementMiddleware",
    "SubAgentExecutionMiddleware",
    "DeterministicTaskLoopGuardMiddleware",
    "TaskOrchestrationState",
    # State classes
    "DeepAgentState",
    "PlanningState", 
    "FilesystemState",
    "Todo",
    "Task",
    "file_reducer",
    # Filesystem
    "FS",
    "FS_LOCK",
    "set_current_thread_id",
    "get_current_thread_id",
    "dump_filesystem",
    "load_filesystem",
    "clear_thread_files",
    "fs_context",
    # Exceptions
    "AgentStopRequestedError",
    "ToolError",
]
