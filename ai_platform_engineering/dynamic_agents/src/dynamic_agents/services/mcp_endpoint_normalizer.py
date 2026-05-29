"""Normalise MCP server endpoints that route through AgentGateway.

This is the Python mirror of ``ui/src/lib/rbac/mcp-endpoint-normalizer.ts``.

Invariant: when an MCP server is dispatched via AgentGateway, the gateway
routes by path prefix ``/mcp/<target>``. A bare
``http://agentgateway:4000/mcp`` falls through to AgentGateway's ``/mcp``
route, which is not registered, and returns ``HTTP 404 Not Found`` on
every probe and tool call.

The Web UI BFF normalises endpoints on save (see ``POST/PUT
/api/mcp-servers``). This module exists so the dynamic-agents probe and
runtime paths can self-heal at read time too — defence in depth against
stale Mongo rows that were written before the save-side normaliser
existed.

Pure functions only: no I/O. Callers pass the configured AgentGateway
base URL so dev/staging/prod and per-tenant overrides flow through one
decision point.
"""

from __future__ import annotations

import re

_PROTOCOL_HOST_RE = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.-]*://[^/]+)")


def _strip_trailing_slashes(url: str) -> str:
    return re.sub(r"/+$", "", url)


def _collapse_slashes(url: str) -> str:
    # Preserve the protocol's ``//`` separator while collapsing every
    # other run of consecutive slashes in the path.
    return re.sub(r"([^:])/{2,}", r"\1/", url)


def _without_mcp_suffix(url: str) -> str:
    return url[: -len("/mcp")] if url.endswith("/mcp") else url


def _origin_of(url: str) -> str:
    match = _PROTOCOL_HOST_RE.match(url)
    return match.group(1) if match else ""


def is_agent_gateway_base_endpoint(endpoint: str, agent_gateway_base_url: str) -> bool:
    """True iff ``endpoint`` points at the gateway base with no target suffix.

    These are the rows we must repair — a "naked" gateway URL. Anything
    else is either healthy (target-qualified) or a direct upstream and
    must NOT be rewritten.
    """
    if not endpoint or not agent_gateway_base_url:
        return False
    trimmed_endpoint = _strip_trailing_slashes(_collapse_slashes(endpoint))
    trimmed_base = _strip_trailing_slashes(_collapse_slashes(agent_gateway_base_url))
    base_origin = _origin_of(trimmed_base)
    if not base_origin or _origin_of(trimmed_endpoint) != base_origin:
        return False
    endpoint_minus_mcp = _without_mcp_suffix(trimmed_endpoint)
    base_minus_mcp = _without_mcp_suffix(trimmed_base)
    return endpoint_minus_mcp in (base_minus_mcp, trimmed_base)


def normalize_mcp_endpoint_for_server(
    endpoint: str | None,
    server_id: str,
    agent_gateway_base_url: str,
) -> str | None:
    """Return the endpoint in target-qualified form when appropriate.

    Behaviour:
        - ``endpoint is None``  → ``None`` (stdio servers)
        - ``endpoint == ""``    → ``""``  (preserve caller's empty value)
        - ``server_id`` empty   → ``endpoint`` unchanged (we refuse to
          invent a suffix; failing closed surfaces bad call sites loudly)
        - Endpoint origin ≠ gateway origin → unchanged (direct upstreams
          are valid; AgentGateway routing is opt-in per server)
        - Otherwise: rewrite to ``{base}/mcp/{server_id}``, repairing
          bare bases, missing ``/mcp`` segments, and wrong suffixes
          (e.g. after a server rename) in one shot.
    """
    if endpoint is None:
        return None
    if endpoint == "":
        return ""
    if not server_id.strip():
        return endpoint

    trimmed_endpoint = _strip_trailing_slashes(_collapse_slashes(endpoint))
    trimmed_base = _strip_trailing_slashes(_collapse_slashes(agent_gateway_base_url))
    if not trimmed_base:
        return endpoint

    if _origin_of(trimmed_endpoint) != _origin_of(trimmed_base):
        return endpoint

    base_with_mcp = (
        trimmed_base if trimmed_base.endswith("/mcp") else f"{trimmed_base}/mcp"
    )
    expected = f"{base_with_mcp}/{server_id.strip()}"
    return expected
