# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Centralised MCP environment-variable resolution.

Every agent that needs MCP host/port/mode should call these helpers
instead of reading ``os.getenv`` directly.  The lookup order is:

1. ``<AGENT>_MCP_HOST``  (e.g. ``CONFLUENCE_MCP_HOST``)
2. ``MCP_HOST``          (generic fallback)
3. hard-coded default    (``localhost`` / ``8000`` / ``stdio``)

This keeps the per-agent override logic in one place and prevents
subclass overrides from accidentally skipping it.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_DEFAULT_HOST = "localhost"
_DEFAULT_PORT = "8000"
_DEFAULT_MODE = "stdio"


def resolve_mcp_mode(agent_name: str) -> str:
    """Return the effective MCP transport mode for *agent_name*.

    Lookup: ``<AGENT>_MCP_MODE`` -> ``MCP_MODE`` -> ``"stdio"``.
    """
    return (
        os.getenv(f"{agent_name.upper()}_MCP_MODE")
        or os.getenv("MCP_MODE", _DEFAULT_MODE)
    ).lower()


def resolve_mcp_host(agent_name: str, default: str = _DEFAULT_HOST) -> str:
    """Return the effective MCP host for *agent_name*.

    Lookup: ``<AGENT>_MCP_HOST`` -> ``MCP_HOST`` -> *default*.
    """
    return (
        os.getenv(f"{agent_name.upper()}_MCP_HOST")
        or os.getenv("MCP_HOST", default)
    )


def resolve_mcp_port(agent_name: str, default: str = _DEFAULT_PORT) -> str:
    """Return the effective MCP port for *agent_name*.

    Lookup: ``<AGENT>_MCP_PORT`` -> ``MCP_PORT`` -> *default*.
    """
    return (
        os.getenv(f"{agent_name.upper()}_MCP_PORT")
        or os.getenv("MCP_PORT", default)
    )


def resolve_mcp_path(agent_name: str, default: str = "/mcp/") -> str:
    """Return the effective MCP path for *agent_name*.

    Lookup: ``<AGENT>_MCP_PATH`` -> *default*.

    When routing through agentgateway the Helm chart sets a per-agent
    path prefix (e.g. ``/mcp/jira``) so the HTTPRoute can dispatch to
    the correct backend.
    """
    return os.getenv(f"{agent_name.upper()}_MCP_PATH", default)


def resolve_mcp_url(
    agent_name: str,
    *,
    default_host: str = _DEFAULT_HOST,
    default_port: str = _DEFAULT_PORT,
    path: str = "/mcp/",
) -> str:
    """Build the full MCP HTTP URL for *agent_name*.

    Combines :func:`resolve_mcp_host` and :func:`resolve_mcp_port` with
    the given *path* (defaults to ``/mcp/``).  If ``<AGENT>_MCP_PATH`` is
    set it takes precedence over the *path* argument.
    """
    host = resolve_mcp_host(agent_name, default=default_host)
    port = resolve_mcp_port(agent_name, default=default_port)
    effective_path = resolve_mcp_path(agent_name, default=path)
    url = f"http://{host}:{port}{effective_path}"
    logger.info("Resolved MCP URL for %s: %s", agent_name, url)
    return url


def is_http_mode(mode: str) -> bool:
    """Return ``True`` if *mode* represents an HTTP-based transport."""
    return mode in ("http", "streamable_http")


def build_http_mcp_config(
    agent_name: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    default_host: str = _DEFAULT_HOST,
    default_port: str = _DEFAULT_PORT,
    path: str = "/mcp/",
) -> Dict[str, Any]:
    """Build a standard HTTP MCP config dict for *agent_name*.

    Returns a dict suitable for passing into ``MultiServerMCPClient``
    (after adding ``"transport": "streamable_http"``).
    """
    return {
        "url": resolve_mcp_url(
            agent_name,
            default_host=default_host,
            default_port=default_port,
            path=path,
        ),
        "headers": headers if headers is not None else {},
    }
