# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Common A2A (Agent-to-Agent) protocol bindings and utilities.

This module provides reusable components for implementing A2A agents with streaming support.
"""

from ai_platform_engineering.common.a2a.base_agent import BaseAgent, debug_print
from ai_platform_engineering.common.a2a.base_agent_executor import BaseAgentExecutor
from ai_platform_engineering.common.a2a.helpers import (
    update_task_with_agent_response,
    process_streaming_agent_response,
)
from ai_platform_engineering.common.a2a.state import (
    AgentState,
    InputState,
    Message,
    MsgType,
)

__all__ = [
    "BaseAgent",
    "BaseAgentExecutor",
    "debug_print",
    "update_task_with_agent_response",
    "process_streaming_agent_response",
    "AgentState",
    "InputState",
    "Message",
    "MsgType",
]

