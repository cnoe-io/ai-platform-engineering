# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6

"""Per-request token resolution for MCP tool functions."""

from __future__ import annotations

import os
from typing import Optional


def get_request_token(env_var_name: str) -> Optional[str]:
    """Return the bearer token for the current request, or fall back to an env var.

    Resolution order:
    1. Authorization: Bearer <token> header of the active HTTP request
    2. os.getenv(env_var_name)

    Silently returns None when called outside an HTTP context (e.g. STDIO mode).
    """
    try:
        from fastmcp.server.dependencies import get_http_request

        req = get_http_request()
        auth = req.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            return auth[7:]
    except Exception:
        # No active HTTP request (STDIO mode) or fastmcp not available.
        pass

    return os.getenv(env_var_name)
