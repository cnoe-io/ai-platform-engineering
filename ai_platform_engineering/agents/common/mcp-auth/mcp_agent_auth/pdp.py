# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Optional Keycloak PDP (Policy Decision Point) check for MCP servers.

This module is **opt-in**. When ``MCP_PDP_ENABLED=true`` and the server
runs in ``MCP_AUTH_MODE=oauth2``, the middleware will additionally
ask Keycloak whether the bearer token grants the configured scope on
the configured resource. The result is cached per-token-hash with a
short TTL so tool calls don't pay the latency on every request.

The check is intended for **embedded MCPs** (e.g. inside a Python
agent process) that do NOT sit behind agentgateway and therefore
miss its CEL-based RBAC gate. MCPs already routed through
agentgateway should leave this off and rely on the gateway's
centralised policy evaluation.

Environment variables (all optional unless noted)
-------------------------------------------------

MCP_PDP_ENABLED          ``true`` to enable the PDP check (default: false)
MCP_PDP_RESOURCE         Keycloak resource name (e.g. ``mcp_jira``).
                         Required when enabled.
MCP_PDP_SCOPE            Scope to check (e.g. ``invoke``).
                         Required when enabled.
MCP_PDP_TOKEN_ENDPOINT   Full Keycloak token endpoint URL.
                         Required when enabled.
MCP_PDP_AUDIENCE         OAuth2 client_id of the resource server
                         (Keycloak ``audience`` for UMA tickets).
                         Required when enabled.
MCP_PDP_CACHE_TTL        Seconds to cache decisions (default: ``30``).
MCP_PDP_HTTP_TIMEOUT     Seconds for the PDP HTTP call (default: ``3``).
MCP_PDP_FAIL_OPEN        ``true`` to allow on PDP errors (default: false,
                         i.e. fail-closed with 503).

Returns
-------

``check_scope_or_503(token)`` returns ``None`` on allow, or a
``(status_code, reason)`` tuple on deny / error. The middleware maps:

  401 — token rejected by Keycloak (e.g. expired)
  403 — Keycloak said deny
  503 — PDP unreachable AND ``MCP_PDP_FAIL_OPEN`` is false
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from typing import Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

# Read config lazily so test code can mutate env between cases.
def _env_bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes")


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning(
            "MCP_PDP: invalid int for %s=%r — using default %d", name, raw, default
        )
        return default


def is_pdp_enabled() -> bool:
    """Return True if the PDP check is enabled AND fully configured.

    We treat partial config as disabled (and log once per process) so a
    half-configured deployment can't silently bypass authorization.
    """
    if not _env_bool("MCP_PDP_ENABLED"):
        return False
    required = (
        os.getenv("MCP_PDP_RESOURCE"),
        os.getenv("MCP_PDP_SCOPE"),
        os.getenv("MCP_PDP_TOKEN_ENDPOINT"),
        os.getenv("MCP_PDP_AUDIENCE"),
    )
    if not all(required):
        # Use a module-level flag so we only log this once.
        global _logged_partial_config
        if not _logged_partial_config:
            logger.error(
                "MCP_PDP_ENABLED=true but required env vars are missing "
                "(MCP_PDP_RESOURCE, MCP_PDP_SCOPE, MCP_PDP_TOKEN_ENDPOINT, "
                "MCP_PDP_AUDIENCE) — PDP check disabled for safety"
            )
            _logged_partial_config = True
        return False
    return True


_logged_partial_config = False

# Decision cache keyed by sha256(token) → (allow:bool, expires_at:float).
# Hashing the token (instead of using it raw) keeps the cache from
# becoming a "where's the bearer token" goldmine for anyone with a
# debug dump of process memory.
_decision_cache: dict[str, Tuple[bool, float]] = {}


def _token_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cache_lookup(token: str) -> Optional[bool]:
    entry = _decision_cache.get(_token_key(token))
    if entry is None:
        return None
    allow, expires_at = entry
    if time.time() >= expires_at:
        return None
    return allow


def _cache_store(token: str, allow: bool, ttl: int) -> None:
    _decision_cache[_token_key(token)] = (allow, time.time() + ttl)


def reset_cache_for_tests() -> None:
    """Test helper: drop the in-memory decision cache."""
    _decision_cache.clear()


async def check_scope_or_503(
    token: str,
) -> Optional[Tuple[int, str]]:
    """Ask Keycloak whether ``token`` grants the configured scope.

    Returns ``None`` on allow, or ``(status, reason)`` on deny / error.
    Decisions are cached for ``MCP_PDP_CACHE_TTL`` seconds keyed on
    the token's SHA-256 hash.
    """
    resource = os.environ["MCP_PDP_RESOURCE"]
    scope = os.environ["MCP_PDP_SCOPE"]
    token_endpoint = os.environ["MCP_PDP_TOKEN_ENDPOINT"]
    audience = os.environ["MCP_PDP_AUDIENCE"]
    cache_ttl = _env_int("MCP_PDP_CACHE_TTL", 30)
    http_timeout = _env_int("MCP_PDP_HTTP_TIMEOUT", 3)
    fail_open = _env_bool("MCP_PDP_FAIL_OPEN")

    cached = _cache_lookup(token)
    if cached is True:
        return None
    if cached is False:
        return (403, f"PDP denied: {resource}#{scope}")

    permission = f"{resource}#{scope}"
    payload = {
        "grant_type": "urn:ietf:params:oauth:grant-type:uma-ticket",
        "audience": audience,
        "permission": permission,
        "response_mode": "decision",
    }

    try:
        async with httpx.AsyncClient(timeout=http_timeout) as client:
            resp = await client.post(
                token_endpoint,
                data=payload,
                headers={"Authorization": f"Bearer {token}"},
            )
    except (httpx.RequestError, httpx.TimeoutException) as exc:
        logger.warning("MCP_PDP: transport error talking to Keycloak: %s", exc)
        if fail_open:
            return None
        return (503, "Authorization service unavailable")

    if resp.status_code == 200:
        try:
            result = resp.json().get("result")
        except ValueError:
            logger.warning("MCP_PDP: non-JSON response from Keycloak")
            return (503, "Authorization service returned malformed response")
        allow = bool(result)
        _cache_store(token, allow, cache_ttl)
        if allow:
            return None
        return (403, f"PDP denied: {permission}")

    # Keycloak returns 403 with {"error": "access_denied"} when the
    # user lacks the permission — cache the deny so we don't re-ask
    # for every tool call in the same conversation.
    if resp.status_code == 403:
        _cache_store(token, False, cache_ttl)
        return (403, f"PDP denied: {permission}")

    # 401 from Keycloak means the bearer itself was rejected (expired,
    # bad signature, etc.). Don't cache — the user might re-auth.
    if resp.status_code == 401:
        return (401, "Token rejected by authorization service")

    # Any other status is treated as a transient PDP failure.
    logger.warning(
        "MCP_PDP: unexpected status %d from Keycloak (body=%r)",
        resp.status_code,
        resp.text[:200],
    )
    if fail_open:
        return None
    return (503, "Authorization service returned unexpected status")
