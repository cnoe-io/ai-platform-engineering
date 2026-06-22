"""Classification of MCP tool-load errors (spec 2026-06-02-mcp-authz-resilience, US3).

Pins the error -> {transient|permanent|denied} mapping that drives both the
bounded retry policy and the user-facing messaging, including the security-
critical rule that a clean policy 403 is a denial (never transient).
"""

from __future__ import annotations

import pytest

from dynamic_agents.services.mcp_client import classify_load_error


@pytest.mark.parametrize(
    "error_msg",
    [
        "read timeout",
        "Request timed out",
        "HTTP 403 Forbidden from http://gw/mcp/x: upstream call timeout",
        "HTTP 502 Bad Gateway from http://x",
        "HTTP 503 Service Unavailable from http://x",
        "HTTP 408 Request Timeout from http://x",
        "HTTP 429 Too Many Requests from http://x",
        "Session terminated",
        "Server disconnected without sending a response",
        "Connection reset by peer",
    ],
)
def test_transient_classification(error_msg):
    assert classify_load_error(error_msg) == "transient"


@pytest.mark.parametrize(
    "error_msg",
    [
        "Cannot connect to http://x: getaddrinfo failed",
        "Name or service not known",
        "All connection attempts failed: Connection refused",
        "HTTP 404 Not Found from http://gw/mcp",
        "SSL: CERTIFICATE_VERIFY_FAILED",
        "MCP endpoint URL is not configured",
        "some unrecognized failure with no signal",
    ],
)
def test_permanent_classification(error_msg):
    assert classify_load_error(error_msg) == "permanent"


@pytest.mark.parametrize(
    "error_msg",
    [
        "HTTP 403 Forbidden from http://x",
        "HTTP 401 Unauthorized from http://x",
    ],
)
def test_denied_classification(error_msg):
    # A clean policy decision (no timeout signal) must be a denial, never retried.
    assert classify_load_error(error_msg) == "denied"


def test_explicit_status_code_overrides_parsing():
    assert classify_load_error("opaque", status_code=503) == "transient"
    assert classify_load_error("opaque", status_code=404) == "permanent"
    assert classify_load_error("opaque", status_code=403) == "denied"
