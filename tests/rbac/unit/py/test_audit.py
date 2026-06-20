"""Spec 102 T027 — unit tests for `audit.log_authz_decision`.

Covers:
  - successful audit-service write           → event batch posted
  - audit-service write failure              → does NOT raise (FR-007)
  - invalid `reason`                         → silently dropped (defensive)
  - decision document validates against the JSON schema in
    `docs/docs/specs/102-comprehensive-rbac-tests-and-completion/contracts/audit-event.schema.json`
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from ai_platform_engineering.utils.auth import audit


_REPO_ROOT = Path(__file__).resolve().parents[4]
_SCHEMA_PATH = (
    _REPO_ROOT
    / "docs/docs/specs/102-comprehensive-rbac-tests-and-completion/contracts/audit-event.schema.json"
)


def test_successful_write_posts_service_event(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUDIT_LOG_BACKEND", "service")
    monkeypatch.setenv("AUDIT_SERVICE_URL", "http://audit-service:8010")
    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client

    with patch("httpx.Client", return_value=mock_client):
        audit.log_authz_decision(
            user_id="alice-sub",
            resource="admin_ui",
            scope="view",
            allowed=True,
            reason="OK",
            service="ui",
            user_email="alice@example.com",
            route="GET /api/admin/users",
            request_id="req-123",
            pdp="keycloak",
        )

    mock_client.post.assert_called_once()
    url, = mock_client.post.call_args.args
    payload = mock_client.post.call_args.kwargs["json"]
    captured = payload["events"][0]

    assert url == "http://audit-service:8010/v1/audit/events"
    assert captured["userId"] == "alice-sub"
    assert captured["userEmail"] == "alice@example.com"
    assert captured["resource"] == "admin_ui"
    assert captured["scope"] == "view"
    assert captured["allowed"] is True
    assert captured["reason"] == "OK"
    assert captured["source"] == "supervisor"
    assert captured["service"] == "ui"
    assert captured["route"] == "GET /api/admin/users"
    assert captured["requestId"] == "req-123"
    assert captured["pdp"] == "keycloak"
    assert captured["type"] == "auth"
    assert captured["tenant_id"] == "default"
    assert captured["subject_hash"].startswith("sha256:")
    assert captured["action"] == "admin_ui#view"
    assert captured["outcome"] == "allow"
    assert captured["correlation_id"] == "req-123"
    assert "ts" in captured
    mock_client.post.return_value.raise_for_status.assert_called_once()


def test_service_failure_does_not_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUDIT_LOG_BACKEND", "service")
    monkeypatch.setenv("AUDIT_SERVICE_URL", "http://audit-service:8010")
    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.post.side_effect = RuntimeError("audit-service down")

    with patch("httpx.Client", return_value=mock_client):
        # Must NOT raise — FR-007.
        audit.log_authz_decision(
            user_id="bob-sub",
            resource="rag",
            scope="retrieve",
            allowed=False,
            reason="DENY_NO_CAPABILITY",
            service="rag_server",
        )


def test_invalid_reason_is_silently_dropped() -> None:
    with patch("httpx.Client") as mock_client_cls:
        audit.log_authz_decision(
            user_id="carol-sub",
            resource="rag",
            scope="ingest",
            allowed=False,
            reason="GIBBERISH",  # not in the closed enum
            service="rag_server",
        )

    mock_client_cls.assert_not_called()


def test_document_validates_against_schema() -> None:
    """Sanity check that what we write matches the contract schema."""
    pytest.importorskip("jsonschema")
    import json
    import jsonschema  # type: ignore[import-untyped]

    schema = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))

    captured: dict[str, Any] = {}

    with patch.object(audit, "_write_service_event", side_effect=lambda doc: captured.update(doc)):
        audit.log_authz_decision(
            user_id="alice-sub",
            resource="admin_ui",
            scope="view",
            allowed=True,
            reason="OK",
            service="ui",
            user_email="alice@example.com",
            route="GET /api/admin/users",
            pdp="keycloak",
        )

    # The contract schema declares `ts` as either an ISO-8601 string (when
    # serialized) or a BSON Date object (when stored in Mongo). For the in-memory
    # validator we serialize datetime to ISO-8601 before checking — this mirrors
    # what bson.json_util would emit for any consumer reading `authz_decisions`
    # over the network.
    from datetime import datetime

    if isinstance(captured.get("ts"), datetime):
        captured["ts"] = captured["ts"].isoformat().replace("+00:00", "Z")

    jsonschema.validate(instance=captured, schema=schema)
