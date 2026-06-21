"""Spec 102 T027 — unit tests for `audit.log_authz_decision`."""

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


def _call_log(**overrides: Any) -> None:
    kwargs: dict[str, Any] = {
        "user_id": "alice-sub",
        "resource": "admin_ui",
        "scope": "view",
        "allowed": True,
        "reason": "OK",
        "service": "ui",
        "user_email": "alice@example.com",
        "route": "GET /api/admin/users",
        "request_id": "req-123",
        "pdp": "keycloak",
    }
    kwargs.update(overrides)
    audit.log_authz_decision(**kwargs)


def test_successful_write_posts_to_audit_service(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUDIT_SERVICE_URL", "http://audit-service:8010")

    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client_cls.return_value = mock_client

        _call_log()

    mock_client.post.assert_called_once()
    url, = mock_client.post.call_args.args
    assert url == "http://audit-service:8010/v1/audit/events"
    event = mock_client.post.call_args.kwargs["json"]["events"][0]
    assert event["userId"] == "alice-sub"
    assert event["userEmail"] == "alice@example.com"
    assert event["resource"] == "admin_ui"
    assert event["scope"] == "view"
    assert event["allowed"] is True
    assert event["reason"] == "OK"
    assert event["type"] == "auth"
    assert event["action"] == "admin_ui#view"
    assert event["outcome"] == "allow"
    assert event["subject_hash"].startswith("sha256:")
    assert event["correlation_id"] == "req-123"


def test_service_failure_does_not_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUDIT_SERVICE_URL", "http://audit-service:8010")

    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.post.side_effect = RuntimeError("audit down")
        mock_client_cls.return_value = mock_client

        _call_log(allowed=False, reason="DENY_NO_CAPABILITY", service="rag_server")


def test_invalid_reason_is_silently_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUDIT_SERVICE_URL", "http://audit-service:8010")

    with patch("httpx.Client") as mock_client_cls:
        _call_log(reason="GIBBERISH")

    mock_client_cls.assert_not_called()


def test_document_validates_against_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sanity check that the legacy-compatible payload still matches the contract schema."""
    pytest.importorskip("jsonschema")
    import json
    import jsonschema  # type: ignore[import-untyped]

    schema = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))
    monkeypatch.setenv("AUDIT_SERVICE_URL", "http://audit-service:8010")

    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client_cls.return_value = mock_client
        _call_log()

    event = dict(mock_client.post.call_args.kwargs["json"]["events"][0])
    for service_only_field in (
        "type",
        "tenant_id",
        "subject_hash",
        "action",
        "outcome",
        "correlation_id",
        "component",
        "user_email",
    ):
        event.pop(service_only_field, None)
    event["source"] = "py"
    if hasattr(event.get("ts"), "isoformat"):
        event["ts"] = event["ts"].isoformat().replace("+00:00", "Z")

    jsonschema.validate(instance=event, schema=schema)
