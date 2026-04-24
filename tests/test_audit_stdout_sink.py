"""Unit tests for the optional stdout JSON audit sink (Spec 102 Phase 11.3).

Asserts:

  - The sink is OFF by default — operators must opt in.
  - When AUDIT_STDOUT_ENABLED=true, every decision produces a single
    line of the form `AUDIT {...json...}\n` on stdout.
  - The JSON payload is a flat object with the required schema fields
    (userId, resource, scope, allowed, reason, source, service, ts).
  - `ts` is serialized as ISO-8601 UTC, not as a Python `datetime` repr.
  - A failing Mongo write still fires the stdout sink (independence).
  - The sink is best-effort — even if json.dumps explodes, the function
    must not raise.
"""

from __future__ import annotations

import io
import json
import sys
from contextlib import contextmanager
from unittest import mock

import pytest

from ai_platform_engineering.utils.auth import audit


@contextmanager
def _capture_stdout():
    saved = sys.stdout
    buf = io.StringIO()
    sys.stdout = buf
    try:
        yield buf
    finally:
        sys.stdout = saved


@pytest.fixture(autouse=True)
def _no_real_mongo():
    """Mock pymongo so tests never touch a live database."""
    fake_client = mock.MagicMock()
    fake_module = mock.MagicMock()
    fake_module.MongoClient = mock.MagicMock(return_value=fake_client)
    with mock.patch.dict(sys.modules, {"pymongo": fake_module}):
        yield fake_client


def _call_log(**overrides):
    """Default decision payload, overridable per test."""
    kwargs = {
        "user_id": "u-1",
        "user_email": "alice@example.com",
        "resource": "rag",
        "scope": "query",
        "allowed": True,
        "reason": "OK",
        "service": "supervisor",
        "route": "POST /tasks",
        "request_id": "rq-9",
        "pdp": "keycloak",
    }
    kwargs.update(overrides)
    audit.log_authz_decision(**kwargs)


class TestStdoutDisabledByDefault:
    def test_no_stdout_emission_without_env(self, monkeypatch):
        monkeypatch.delenv("AUDIT_STDOUT_ENABLED", raising=False)
        with _capture_stdout() as buf:
            _call_log()
        assert buf.getvalue() == "", (
            "Audit stdout sink must be opt-in via AUDIT_STDOUT_ENABLED"
        )


class TestStdoutEnabled:
    @pytest.fixture(autouse=True)
    def _enable(self, monkeypatch):
        monkeypatch.setenv("AUDIT_STDOUT_ENABLED", "true")

    def test_emits_single_audit_line(self):
        with _capture_stdout() as buf:
            _call_log()
        out = buf.getvalue()
        assert out.endswith("\n")
        assert out.count("\n") == 1, f"Expected exactly one line, got {out!r}"
        assert out.startswith("AUDIT "), f"Missing AUDIT marker: {out!r}"

    def test_payload_is_valid_json_with_required_fields(self):
        with _capture_stdout() as buf:
            _call_log()
        line = buf.getvalue()
        payload = json.loads(line[len("AUDIT ") :].strip())
        # Required fields per audit-event.schema.json
        for field in ("userId", "resource", "scope", "allowed", "reason", "source", "service", "ts"):
            assert field in payload, f"Missing required field {field}: {payload!r}"
        assert payload["allowed"] is True
        assert payload["source"] == "py"

    def test_ts_is_iso_8601_utc(self):
        with _capture_stdout() as buf:
            _call_log()
        payload = json.loads(buf.getvalue()[len("AUDIT ") :].strip())
        # ISO-8601 UTC ends with +00:00 (datetime.isoformat with tzinfo)
        assert payload["ts"].endswith("+00:00"), payload["ts"]

    def test_truthy_env_values_all_enable(self, monkeypatch):
        for val in ("1", "true", "True", "YES", "yes"):
            monkeypatch.setenv("AUDIT_STDOUT_ENABLED", val)
            with _capture_stdout() as buf:
                _call_log()
            assert buf.getvalue().startswith("AUDIT "), f"value {val!r} should enable"

    def test_falsy_env_values_disable(self, monkeypatch):
        for val in ("0", "false", "no", "off", ""):
            monkeypatch.setenv("AUDIT_STDOUT_ENABLED", val)
            with _capture_stdout() as buf:
                _call_log()
            assert buf.getvalue() == "", f"value {val!r} should NOT enable"


class TestSinkIndependence:
    def test_mongo_failure_does_not_suppress_stdout(self, monkeypatch):
        monkeypatch.setenv("AUDIT_STDOUT_ENABLED", "true")
        # Inject a pymongo stub that raises on any operation.
        fake_module = mock.MagicMock()
        fake_module.MongoClient.side_effect = RuntimeError("mongo down")
        with mock.patch.dict(sys.modules, {"pymongo": fake_module}):
            with _capture_stdout() as buf:
                _call_log()
        assert buf.getvalue().startswith("AUDIT "), (
            "stdout sink must fire even when Mongo is unavailable"
        )

    def test_invalid_reason_blocks_both_sinks(self, monkeypatch):
        # Invalid reason short-circuits before either sink fires (FR-007).
        monkeypatch.setenv("AUDIT_STDOUT_ENABLED", "true")
        with _capture_stdout() as buf:
            _call_log(reason="NOT_A_REAL_REASON")
        assert buf.getvalue() == ""


class TestStdoutSinkBestEffort:
    def test_json_dumps_failure_does_not_raise(self, monkeypatch):
        monkeypatch.setenv("AUDIT_STDOUT_ENABLED", "true")
        # Patch json.dumps in the audit module's namespace to blow up.
        monkeypatch.setattr(
            audit.json,
            "dumps",
            mock.MagicMock(side_effect=TypeError("not serializable")),
        )
        # Must NOT raise — sink is best-effort.
        _call_log()
