# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
A2A (Agent-to-Agent) utilities and base classes.

Provides the LangGraph-based agent pattern:
BaseLangGraphAgent + BaseLangGraphAgentExecutor.

Import only what you need to avoid unnecessary dependencies:
- For LangGraph agents: from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
"""

# assisted-by Codex Codex-sonnet-4-6
# Agents should import base classes directly from the specific modules they need.
from .state import (
    AgentState,
    InputState,
    OutputState,
    Message,
    MsgType,
    ConfigSchema,
)
from .helpers import (
    update_task_with_agent_response,
    process_streaming_agent_response,
)

__all__ = [
    # State management (shared by both patterns)
    "AgentState",
    "InputState",
    "OutputState",
    "Message",
    "MsgType",
    "ConfigSchema",
    # Utilities (shared by both patterns)
    "update_task_with_agent_response",
    "process_streaming_agent_response",
    # Note: Base classes are NOT exported here to avoid dependency bloat
    # Import them directly from their modules:
    # - BaseLangGraphAgent from .base_langgraph_agent
]
