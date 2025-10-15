# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
AI Platform Engineering Utilities

This package contains common utilities, base classes, and shared functionality
for AI Platform Engineering agents and applications.
"""

# A2A (Agent-to-Agent) utilities
from .a2a import (
  BaseAgent,
  BaseAgentExecutor,
  debug_print,
  update_task_with_agent_response,
  process_streaming_agent_response,
  AgentState,
  InputState,
  Message,
  MsgType
)

# Authentication utilities
from .auth import *

# Agntcy utilities
from .agntcy import *

# Miscellaneous utilities
from .misc import *

# Data models
from .models import *

# OAuth utilities
from .oauth import *

__all__ = [
    # A2A exports
    "BaseAgent",
    "BaseAgentExecutor",
    "debug_print",
    "update_task_with_agent_response",
    "process_streaming_agent_response",
    "AgentState",
    "InputState",
    "Message",
    "MsgType",
    # Add other exports as needed
]