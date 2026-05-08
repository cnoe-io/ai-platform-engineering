# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for ``services.supervisor_preflight`` (spec #099 FR-001..005).

Pre-flight is the *no-raise* contract: every failure mode the network or
supervisor can produce MUST round-trip back to the caller as an
:class:`Acknowledgement` with an appropriate ``ack_status`` rather than
an exception. The tests below exercise each branch.

Why this is a separate test module from ``test_a2a_client``: preflight
deliberately does NOT use the circuit breaker or tenacity retry stack
the run-time ``invoke_agent`` call uses (rationale in
``services/supervisor_preflight.py`` module docstring), so the test surface is
materially different and shares no fixtures with ``test_a2a_client``.
"""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest

from autonomous_agents.config import Settings, get_settings
from autonomous_agents.services import supervisor_preflight as pf_mod
from autonomous_agents.services.acknowledgement import Acknowledgement
from autonomous_agents.services.supervisor_preflight import (
    PREFLIGHT_TIMEOUT_SECONDS_DEFAULT,
    _extract_ack_payload,
    preflight,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ok_response_body(
    *,
    routed_to: str | None = "github",
    tools: list[str] | None = None,
    available: list[str] | None = None,
) -> dict[str, Any]:
    """Build a supervisor success body containing exactly one preflight_ack artifact."""
    return {
        "result": {
            "artifacts": [
                {
                    "name": "preflight_ack",
                    "description": "Pre-flight acknowledgement from supervisor",
                    "parts": [
                        {
                            "kind": "data",
                            "data": {
                                "ack_status": "ok",
                                "ack_detail": "Sub-agent loaded; ready.",
                                "routed_to": routed_to,
                                "tools": tools or ["list_pull_requests"],
                                "available_agents": available or ["github", "argocd"],
                                "credentials_status": {},
                                "dry_run_summary": "Will route to github.",
                                "ack_at": "2026-04-19T18:00:00Z",
                            },
                        }
                    ],
                }
            ]
        }
    }


def _supervisor_failure_body(detail: str) -> dict[str, Any]:
    """Supervisor responds with an artifact whose ack_status is 'failed'."""
    return {
        "result": {
            "artifacts": [
                {
                    "name": "preflight_ack",
                    "parts": [
                        {
                            "kind": "data",
                            "data": {
                                "ack_status": "failed",
                                "ack_detail": detail,
                                "routed_to": None,
                                "tools": [],
                                "available_agents": ["argocd"],
                                "credentials_status": {},
                                "dry_run_summary": "Routing target unknown.",
                                "ack_at": "2026-04-19T18:00:00Z",
                            },
                        }
                    ],
                }
            ]
        }
    }


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch):
    """Ensure each test sees a fresh Settings object pointed at a fake URL."""
    get_settings.cache_clear()
    fake = Settings(supervisor_url="http://supervisor.test", llm_provider="openai")
    monkeypatch.setattr(pf_mod, "get_settings", lambda: fake)
    yield fake
    get_settings.cache_clear()


def _install_mock_transport(monkeypatch, handler):
    """Patch httpx.AsyncClient so every preflight() call routes through ``handler``.

    ``handler`` receives the outgoing httpx.Request and returns an httpx.Response.
    Using MockTransport keeps the test honest about the full request/response
    lifecycle (status code, json body, headers) without needing a real socket.
    """
    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        kwargs.setdefault("timeout", PREFLIGHT_TIMEOUT_SECONDS_DEFAULT)
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(pf_mod.httpx, "AsyncClient", _factory)


# ---------------------------------------------------------------------------
# _extract_ack_payload
# ---------------------------------------------------------------------------

def test_extract_ack_payload_pulls_data_part_from_named_artifact():
    body = _ok_response_body()
    extracted = _extract_ack_payload(body)
    assert extracted is not None
    assert extracted["ack_status"] == "ok"
    assert extracted["routed_to"] == "github"


def test_extract_ack_payload_returns_none_when_artifact_missing():
    body = {"result": {"artifacts": [{"name": "final_result", "parts": []}]}}
    assert _extract_ack_payload(body) is None


def test_extract_ack_payload_tolerates_root_wrapped_data():
    """Some a2a-sdk versions wrap parts in {'root': {'data': {...}}} — accept it."""
    body = {
        "result": {
            "artifacts": [
                {
                    "name": "preflight_ack",
                    "parts": [{"root": {"data": {"ack_status": "ok"}}}],
                }
            ]
        }
    }
    extracted = _extract_ack_payload(body)
    assert extracted == {"ack_status": "ok"}


# ---------------------------------------------------------------------------
# Acknowledgement model
# ---------------------------------------------------------------------------

def test_acknowledgement_transport_failure_classifies_as_pending():
    ack = Acknowledgement.transport_failure("supervisor down")
    assert ack.ack_status == "pending"
    assert "supervisor down" in ack.ack_detail
    assert ack.routed_to is None
    assert ack.tools == []


def test_acknowledgement_application_failure_classifies_as_failed():
    ack = Acknowledgement.application_failure("HTTP 500")
    assert ack.ack_status == "failed"
    assert "HTTP 500" in ack.ack_detail


# ---------------------------------------------------------------------------
# preflight() — happy path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_preflight_returns_ok_ack_when_supervisor_responds_with_artifact(
    monkeypatch,
):
    captured_request = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request["url"] = str(request.url)
        captured_request["body"] = request.read().decode()
        return httpx.Response(200, json=_ok_response_body())

    _install_mock_transport(monkeypatch, handler)

    ack = await preflight(
        task_id="t-123",
        prompt="list open PRs",
        agent="github",
        llm_provider="openai",
    )

    assert ack.ack_status == "ok"
    assert ack.routed_to == "github"
    assert "list_pull_requests" in ack.tools
    assert "github" in ack.available_agents
    # Verify wire shape: the request must carry metadata.preflight=True.
    # Parse the body rather than substring-matching so the assertion is
    # robust to JSON serializer whitespace differences across httpx versions.
    import json as _json
    sent = _json.loads(captured_request["body"])
    sent_meta = sent["params"]["message"]["metadata"]
    assert sent_meta["preflight"] is True
    assert sent_meta["agent"] == "github"
    assert sent_meta["llm_provider"] == "openai"
    # contextId is deterministic UUIDv5(NAMESPACE_URL, "autonomous-task:t-123")
    expected_ctx = str(uuid.uuid5(uuid.NAMESPACE_URL, "autonomous-task:t-123"))
    assert sent["params"]["message"]["contextId"] == expected_ctx


@pytest.mark.asyncio
async def test_preflight_passes_supervisor_failure_through_to_caller(monkeypatch):
    """Supervisor returned ack_status=failed — preflight() reports it as-is."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_supervisor_failure_body("agent 'foo' is not enabled"))

    _install_mock_transport(monkeypatch, handler)

    ack = await preflight(task_id="t-1", prompt="x", agent="foo")
    assert ack.ack_status == "failed"
    assert "not enabled" in ack.ack_detail
    assert ack.routed_to is None


# ---------------------------------------------------------------------------
# preflight() — failure modes
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_preflight_returns_pending_on_transport_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        raise httpx.ConnectError("supervisor down", request=request)

    _install_mock_transport(monkeypatch, handler)

    ack = await preflight(task_id="t-1", prompt="x", agent="github")
    assert ack.ack_status == "pending"
    assert "did not respond" in ack.ack_detail


@pytest.mark.asyncio
async def test_preflight_returns_failed_on_5xx(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(503, text="service unavailable")

    _install_mock_transport(monkeypatch, handler)

    ack = await preflight(task_id="t-1", prompt="x", agent="github")
    assert ack.ack_status == "failed"
    assert "503" in ack.ack_detail


@pytest.mark.asyncio
async def test_preflight_returns_failed_on_jsonrpc_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": "1", "error": {"code": -32600, "message": "bad request"}},
        )

    _install_mock_transport(monkeypatch, handler)

    ack = await preflight(task_id="t-1", prompt="x", agent="github")
    assert ack.ack_status == "failed"
    assert "bad request" in ack.ack_detail


@pytest.mark.asyncio
async def test_preflight_returns_pending_when_supervisor_omits_preflight_artifact(monkeypatch):
    """Supervisor build that predates spec #099 returns a normal response.

    We treat that as 'pending' (soft) rather than 'failed' (hard) so the
    UI surfaces a recoverable yellow state rather than alarming the user.
    """
    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(
            200,
            json={
                "result": {
                    "artifacts": [
                        {"name": "final_result", "parts": [{"kind": "text", "text": "hi"}]}
                    ]
                }
            },
        )

    _install_mock_transport(monkeypatch, handler)

    ack = await preflight(task_id="t-1", prompt="x", agent="github")
    assert ack.ack_status == "pending"
    assert "preflight_ack" in ack.ack_detail


@pytest.mark.asyncio
async def test_preflight_returns_failed_on_invalid_payload_shape(monkeypatch):
    """Supervisor returned the right artifact name but malformed payload."""
    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(
            200,
            json={
                "result": {
                    "artifacts": [
                        {
                            "name": "preflight_ack",
                            "parts": [
                                {"kind": "data", "data": {"ack_status": "INVALID_LITERAL"}}
                            ],
                        }
                    ]
                }
            },
        )

    _install_mock_transport(monkeypatch, handler)

    ack = await preflight(task_id="t-1", prompt="x", agent="github")
    assert ack.ack_status == "failed"
    assert "unrecognised" in ack.ack_detail.lower()
