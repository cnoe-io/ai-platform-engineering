# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for ``services.supervisor_preflight``.

Pre-flight is the no-raise contract: every failure mode the network or
supervisor can produce round-trips back to the caller as an
:class:`Acknowledgement` rather than an exception.
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


def _ok_response_body(
    *,
    routed_to: str | None = "github",
    tools: list[str] | None = None,
    available: list[str] | None = None,
) -> dict[str, Any]:
    """Build a supervisor success body containing one preflight_ack artifact."""
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
    """Each test sees a fresh Settings object pointed at a fake URL."""
    get_settings.cache_clear()
    fake = Settings(supervisor_url="http://supervisor.test", llm_provider="openai")
    monkeypatch.setattr(pf_mod, "get_settings", lambda: fake)
    yield fake
    get_settings.cache_clear()


def _install_mock_transport(monkeypatch, handler):
    """Patch httpx.AsyncClient so every preflight() call routes through ``handler``."""
    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        kwargs.setdefault("timeout", PREFLIGHT_TIMEOUT_SECONDS_DEFAULT)
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(pf_mod.httpx, "AsyncClient", _factory)


class TestExtractAckPayload:
    """``_extract_ack_payload`` finds the data part of the named artifact."""

    def test_extract_ack_payload_pulls_data_part_from_named_artifact(self):
        """A standard preflight_ack artifact yields its data dict."""
        body = _ok_response_body()
        extracted = _extract_ack_payload(body)
        assert extracted is not None
        assert extracted["ack_status"] == "ok"
        assert extracted["routed_to"] == "github"

    def test_extract_ack_payload_returns_none_when_artifact_missing(self):
        """A response without preflight_ack returns ``None``."""
        body = {"result": {"artifacts": [{"name": "final_result", "parts": []}]}}
        assert _extract_ack_payload(body) is None

    def test_extract_ack_payload_tolerates_root_wrapped_data(self):
        """Some a2a-sdk versions wrap parts in {'root': {'data': {...}}}."""
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


class TestAcknowledgementModel:
    """``Acknowledgement`` constructor classifications."""

    def test_acknowledgement_transport_failure_classifies_as_pending(self):
        """Transport failures produce ``pending`` acks."""
        ack = Acknowledgement.transport_failure("supervisor down")
        assert ack.ack_status == "pending"
        assert "supervisor down" in ack.ack_detail
        assert ack.routed_to is None
        assert ack.tools == []

    def test_acknowledgement_application_failure_classifies_as_failed(self):
        """Application failures produce ``failed`` acks."""
        ack = Acknowledgement.application_failure("HTTP 500")
        assert ack.ack_status == "failed"
        assert "HTTP 500" in ack.ack_detail


class TestPreflightHappyPath:
    """``preflight`` returns the supervisor's ack verbatim on success."""

    @pytest.mark.asyncio
    async def test_preflight_returns_ok_ack_when_supervisor_responds_with_artifact(
        self, monkeypatch,
    ):
        """A 200 + preflight_ack artifact yields an ``ok`` acknowledgement."""
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
        import json as _json
        sent = _json.loads(captured_request["body"])
        sent_meta = sent["params"]["message"]["metadata"]
        assert sent_meta["preflight"] is True
        assert sent_meta["agent"] == "github"
        assert sent_meta["llm_provider"] == "openai"
        expected_ctx = str(uuid.uuid5(uuid.NAMESPACE_URL, "autonomous-task:t-123"))
        assert sent["params"]["message"]["contextId"] == expected_ctx

    @pytest.mark.asyncio
    async def test_preflight_passes_supervisor_failure_through_to_caller(
        self, monkeypatch,
    ):
        """A supervisor ``ack_status=failed`` is propagated as-is."""
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=_supervisor_failure_body("agent 'foo' is not enabled"))

        _install_mock_transport(monkeypatch, handler)

        ack = await preflight(task_id="t-1", prompt="x", agent="foo")
        assert ack.ack_status == "failed"
        assert "not enabled" in ack.ack_detail
        assert ack.routed_to is None


class TestPreflightFailureModes:
    """Every wire / payload failure round-trips as an ack, never an exception."""

    @pytest.mark.asyncio
    async def test_preflight_returns_pending_on_transport_error(self, monkeypatch):
        """A transport error becomes a ``pending`` ack."""
        def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
            raise httpx.ConnectError("supervisor down", request=request)

        _install_mock_transport(monkeypatch, handler)

        ack = await preflight(task_id="t-1", prompt="x", agent="github")
        assert ack.ack_status == "pending"
        assert "did not respond" in ack.ack_detail

    @pytest.mark.asyncio
    async def test_preflight_returns_failed_on_5xx(self, monkeypatch):
        """A 5xx status becomes a ``failed`` ack."""
        def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
            return httpx.Response(503, text="service unavailable")

        _install_mock_transport(monkeypatch, handler)

        ack = await preflight(task_id="t-1", prompt="x", agent="github")
        assert ack.ack_status == "failed"
        assert "503" in ack.ack_detail

    @pytest.mark.asyncio
    async def test_preflight_returns_failed_on_jsonrpc_error(self, monkeypatch):
        """A JSON-RPC error envelope becomes a ``failed`` ack."""
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
    async def test_preflight_returns_pending_when_supervisor_omits_preflight_artifact(
        self, monkeypatch,
    ):
        """A supervisor that lacks the preflight artifact yields ``pending``."""
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
    async def test_preflight_returns_failed_on_invalid_payload_shape(self, monkeypatch):
        """A preflight_ack artifact with a malformed payload becomes ``failed``."""
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
