"""Custom deepagents utilities for the AI Platform Engineering project.

This module provides custom middleware, state classes, and utilities that extend
the official deepagents package with platform-specific functionality.

The official deepagents package (>=0.3.8) provides:
- create_deep_agent
- TodoListMiddleware, FilesystemMiddleware, SubAgentMiddleware
- Built-in filesystem and planning tools (write_todos, task, read_file, etc.)

This custom module provides:
- DeterministicTaskMiddleware - Executes task_config.yaml workflows deterministically
- CallToolWithFileArgMiddleware - Auto-substitutes file paths with contents in tool args
- PolicyMiddleware - ASP-based policy evaluation for tool call authorization
- Custom state classes (DeepAgentState, Todo, Task)
- Filesystem utility tool (tool_result_to_file)

Note: For filesystem state sharing between subagents, use SubAgent dict format
(not CompiledSubAgent). SubAgentMiddleware builds these with shared StateBackend.
"""

# Re-export official deepagents components
from deepagents import create_deep_agent

# Export custom middleware
from ai_platform_engineering.utils.deepagents_custom.middleware import (
    DeterministicTaskMiddleware,
    TaskOrchestrationState,
    # Legacy aliases for backwards compatibility
    QuickActionTasksAnnouncementMiddleware,
    SubAgentExecutionMiddleware,
)

from ai_platform_engineering.utils.deepagents_custom.file_arg_middleware import (
    CallToolWithFileArgMiddleware,
    CALL_TOOL_WITH_FILE_ARG_SYSTEM_PROMPT,
)

from ai_platform_engineering.utils.deepagents_custom.policy_middleware import (
    PolicyMiddleware,
    CLORM_AVAILABLE,
)

# Export custom tools
from ai_platform_engineering.utils.deepagents_custom.tools import (
    tool_result_to_file,
    FS_TOOL_NAMES,
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

# Export exceptions
from ai_platform_engineering.utils.deepagents_custom.exceptions import (
    AgentStopRequestedError,
    ToolError,
)

__all__ = [
    # Official deepagents
    "create_deep_agent",
    # Custom middleware
    "DeterministicTaskMiddleware",
    "TaskOrchestrationState",
    "CallToolWithFileArgMiddleware",
    "CALL_TOOL_WITH_FILE_ARG_SYSTEM_PROMPT",
    "PolicyMiddleware",
    "CLORM_AVAILABLE",
    # Legacy aliases
    "QuickActionTasksAnnouncementMiddleware",
    "SubAgentExecutionMiddleware",
    # Custom tools
    "tool_result_to_file",
    "FS_TOOL_NAMES",
    # State classes
    "DeepAgentState",
    "PlanningState", 
    "FilesystemState",
    "Todo",
    "Task",
    "file_reducer",
    # Exceptions
    "AgentStopRequestedError",
    "ToolError",
]
