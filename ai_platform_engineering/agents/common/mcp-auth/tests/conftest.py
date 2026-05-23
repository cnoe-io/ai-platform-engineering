# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Shared pytest fixtures for mcp-agent-auth tests.

Auth env vars are read at *import time* by ``middleware.py``, so each
test that exercises a different mode must (a) set its env, (b) call
``importlib.reload`` on the module, and (c) restore the originals.
The ``reload_middleware`` fixture wraps that pattern.
"""

from __future__ import annotations

import importlib
from typing import Iterator

import pytest


@pytest.fixture
def reload_middleware(monkeypatch):
    """Reload mcp_agent_auth.middleware with a custom env.

    Usage::

        def test_something(reload_middleware):
            mod = reload_middleware({"MCP_AUTH_MODE": "shared_key", ...})
            ...

    Env vars not in the dict are cleared so leakage from other
    fixtures can't pollute the import-time validation.
    """
    auth_keys = (
        "MCP_AUTH_MODE",
        "MCP_SHARED_KEY",
        "MCP_TRUSTED_LOCALHOST",
        "JWKS_URI",
        "AUDIENCE",
        "ISSUER",
        "ALLOWED_ALGORITHMS",
        "OAUTH2_CLIENT_ID",
        "MCP_PDP_ENABLED",
        "MCP_PDP_RESOURCE",
        "MCP_PDP_SCOPE",
        "MCP_PDP_TOKEN_ENDPOINT",
        "MCP_PDP_AUDIENCE",
        "MCP_PDP_CACHE_TTL",
        "MCP_PDP_HTTP_TIMEOUT",
        "MCP_PDP_FAIL_OPEN",
    )

    def _reload(env: dict[str, str]):
        for k in auth_keys:
            monkeypatch.delenv(k, raising=False)
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        import mcp_agent_auth.middleware as middleware
        return importlib.reload(middleware)

    return _reload


@pytest.fixture(autouse=True)
def _reset_pdp_cache() -> Iterator[None]:
    """Drop the PDP decision cache between tests."""
    from mcp_agent_auth import pdp

    pdp.reset_cache_for_tests()
    yield
    pdp.reset_cache_for_tests()
