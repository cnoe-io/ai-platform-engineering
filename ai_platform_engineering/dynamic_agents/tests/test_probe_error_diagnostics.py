"""Regression tests for ``probe_server_tools`` error diagnostics.

The MCP streamable-http transport surfaces upstream HTTP failures as a
generic ``Session terminated`` string without an attached ``response``
object, so the previous probe path produced the unhelpful banner
"Failed to connect to MCP server: Session terminated" in the Create
Agent UI whenever AgentGateway returned 401/403 (or the upstream MCP
server returned any HTTP error early).

The fix: when the underlying exception is an opaque session-termination
message, ``probe_server_tools`` performs a direct HTTP probe against the
same endpoint so it can attach the real HTTP status and reason phrase to
the error surfaced upstream. These tests pin that contract.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import AsyncMock, patch

import pytest

from dynamic_agents.models import MCPServerConfig, TransportType
from dynamic_agents.services import mcp_client


class _StatusHandler(BaseHTTPRequestHandler):
    """In-process HTTP handler that replies with a configurable status."""

    status_code: int = 200
    reason_phrase: str | None = None

    def _respond(self) -> None:
        status = self.__class__.status_code
        reason = self.__class__.reason_phrase
        if reason is not None:
            self.send_response(status, reason)
        else:
            self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"detail":"upstream"}')

    do_GET = _respond  # noqa: N815
    do_POST = _respond  # noqa: N815
    do_HEAD = _respond  # noqa: N815

    def log_message(self, *_a, **_kw):
        # Keep test output quiet.
        return


@contextmanager
def _http_server(status: int, reason: str | None = None):
    _StatusHandler.status_code = status
    _StatusHandler.reason_phrase = reason
    server = HTTPServer(("127.0.0.1", 0), _StatusHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/mcp"
    finally:
        server.shutdown()
        thread.join(timeout=2)


def _make_server(endpoint: str) -> MCPServerConfig:
    return MCPServerConfig(
        _id="argocd",
        name="Argocd",
        transport=TransportType.HTTP,
        endpoint=endpoint,
        enabled=True,
    )


@pytest.mark.asyncio
async def test_probe_translates_session_terminated_to_http_status_when_upstream_denies():
    """A 401 from the upstream MCP server should surface as a concrete HTTP
    status in the error message, not the opaque ``Session terminated`` string
    that the streamable-http transport raises internally.
    """

    with _http_server(401) as endpoint:
        server = _make_server(endpoint)

        # Force the MCP client to raise the exact failure mode users hit:
        # an ExceptionGroup containing an inner RuntimeError whose message is
        # ``Session terminated``. ``probe_server_tools`` is expected to fall
        # back to a direct HTTP probe and attach the real status code.
        inner = RuntimeError("Session terminated")
        group = ExceptionGroup("mcp transport failed", [inner])
        with patch.object(
            mcp_client,
            "MultiServerMCPClient",
            autospec=True,
        ) as ctor:
            ctor.return_value.get_tools = AsyncMock(side_effect=group)

            with pytest.raises(RuntimeError) as excinfo:
                await mcp_client.probe_server_tools(server)

        message = str(excinfo.value)
        # The new contract: surface the upstream HTTP status, not the opaque
        # transport message.
        assert "401" in message, f"expected upstream status in message: {message!r}"
        assert "Session terminated" not in message, (
            f"opaque transport message must be replaced: {message!r}"
        )


@pytest.mark.asyncio
async def test_probe_keeps_non_session_terminated_errors_unchanged():
    """If the MCP client raises something other than ``Session terminated``,
    the existing diagnostic path is preserved so we don't paper over genuine
    bugs."""

    with _http_server(200) as endpoint:
        server = _make_server(endpoint)

        inner = RuntimeError("backend exploded mid-handshake")
        group = ExceptionGroup("mcp transport failed", [inner])
        with patch.object(
            mcp_client,
            "MultiServerMCPClient",
            autospec=True,
        ) as ctor:
            ctor.return_value.get_tools = AsyncMock(side_effect=group)

            with pytest.raises(RuntimeError) as excinfo:
                await mcp_client.probe_server_tools(server)

        # Non-opaque inner exceptions should round-trip through the existing
        # path (no second HTTP probe, no rewriting).
        assert "backend exploded mid-handshake" in str(excinfo.value)


@pytest.mark.asyncio
async def test_probe_reports_connection_failure_when_endpoint_is_unreachable():
    """If the upstream isn't reachable at all (closed port), surface a
    connection-failure message rather than implying it's an HTTP problem."""

    # Use a high port that's almost certainly not listening locally.
    server = _make_server("http://127.0.0.1:1/mcp")

    inner = RuntimeError("Session terminated")
    group = ExceptionGroup("mcp transport failed", [inner])
    with patch.object(
        mcp_client,
        "MultiServerMCPClient",
        autospec=True,
    ) as ctor:
        ctor.return_value.get_tools = AsyncMock(side_effect=group)

        with pytest.raises(RuntimeError) as excinfo:
            await mcp_client.probe_server_tools(server)

    message = str(excinfo.value)
    # No HTTP status was ever seen — caller should know it's a connection
    # problem, not an authorization or upstream-error problem.
    assert "Session terminated" not in message
    # We don't pin the exact wording, but the operator needs to be able to
    # tell this apart from an HTTP-status failure.
    assert "connect" in message.lower() or "reach" in message.lower() or "unreachable" in message.lower(), (
        f"expected a connectivity hint in: {message!r}"
    )
