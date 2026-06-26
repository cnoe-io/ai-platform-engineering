# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6

"""Per-request bearer token context for MCP servers.

Set by MCPAuthMiddleware after validating an incoming request.
Read by downstream code (e.g. MCP tools calling other MCP servers) to
forward the validated token without changing function signatures.
"""

from contextvars import ContextVar
from typing import Optional

current_bearer_token: ContextVar[Optional[str]] = ContextVar(
    "mcp_current_bearer_token", default=None
)
