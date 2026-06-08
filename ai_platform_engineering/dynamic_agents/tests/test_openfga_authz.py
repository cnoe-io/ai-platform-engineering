"""Unit tests for Dynamic Agents OpenFGA runtime authorization."""

from __future__ import annotations

import base64
import json
import logging

import pytest
from fastapi import HTTPException

from dynamic_agents.auth.token_context import current_user_token


def _fake_jwt(payload: dict) -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    return f"{header}.{body}."


@pytest.mark.asyncio
async def test_openfga_check_forwards_traceparent(monkeypatch):
    from dynamic_agents.auth import openfga_authz
    from dynamic_agents.auth.token_context import current_traceparent

    requests: list[tuple[str, dict[str, str] | None]] = []

    class FakeResponse:
        def __init__(self, payload: dict):
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, url: str, **kwargs):
            requests.append((url, kwargs.get("headers")))
            return FakeResponse({"stores": [{"name": "caipe-openfga", "id": "store-1"}]})

        async def post(self, url: str, **kwargs):
            requests.append((url, kwargs.get("headers")))
            return FakeResponse({"allowed": True})

    traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"
    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga:8080")
    monkeypatch.setattr(openfga_authz.httpx, "AsyncClient", FakeClient)
    trace_ref = current_traceparent.set(traceparent)
    try:
        assert await openfga_authz._check_agent_use("alice-sub", "agent-1") is True
    finally:
        current_traceparent.reset(trace_ref)

    assert requests
    assert all(headers and headers["traceparent"] == traceparent for _, headers in requests)


@pytest.mark.asyncio
async def test_allows_agent_use_when_openfga_allows(monkeypatch):
    from dynamic_agents.auth import openfga_authz

    calls: list[tuple[str, str]] = []

    async def fake_check(subject: str, agent_id: str) -> bool:
        calls.append((subject, agent_id))
        return True

    monkeypatch.setattr(openfga_authz, "_check_agent_use", fake_check)
    token_ref = current_user_token.set(_fake_jwt({"sub": "alice-sub"}))
    try:
        await openfga_authz.require_agent_use_permission("agent-1")
    finally:
        current_user_token.reset(token_ref)

    assert calls == [("alice-sub", "agent-1")]


@pytest.mark.asyncio
async def test_allows_agent_use_with_email_membership_fallback(monkeypatch):
    from dynamic_agents.auth import openfga_authz

    calls: list[tuple[str, str]] = []

    async def fake_check(subject: str, agent_id: str) -> bool:
        calls.append((subject, agent_id))
        return subject == "alice@example.com"

    monkeypatch.setattr(openfga_authz, "_check_agent_use", fake_check)
    token_ref = current_user_token.set(
        _fake_jwt({"sub": "alice-sub", "email": "alice@example.com"})
    )
    try:
        await openfga_authz.require_agent_use_permission("agent-1")
    finally:
        current_user_token.reset(token_ref)

    assert calls == [("alice-sub", "agent-1"), ("alice@example.com", "agent-1")]


@pytest.mark.asyncio
async def test_logs_openfga_rebac_audit_for_runtime_allow(monkeypatch, caplog):
    from dynamic_agents.auth import openfga_authz

    persisted: list[dict] = []

    async def fake_check(subject: str, agent_id: str) -> bool:
        return True

    monkeypatch.setattr(openfga_authz, "_check_agent_use", fake_check)
    monkeypatch.setattr(
        openfga_authz,
        "_persist_openfga_rebac_audit",
        lambda event: persisted.append(event),
        raising=False,
    )
    token_ref = current_user_token.set(_fake_jwt({"sub": "alice-sub"}))
    with caplog.at_level(logging.INFO, logger="dynamic_agents.auth.openfga_authz"):
        try:
            await openfga_authz.require_agent_use_permission("agent-1")
        finally:
            current_user_token.reset(token_ref)

    audit = json.loads(caplog.records[-1].message)
    assert audit["type"] == "openfga_rebac"
    assert audit["action"] == "dynamic_agent#use"
    assert audit["outcome"] == "allow"
    assert audit["pdp"] == "openfga"
    assert audit["resource_ref"] == "agent:agent-1"
    assert audit["subject_hash"].startswith("sha256:")
    assert persisted == [audit]


@pytest.mark.asyncio
async def test_denies_agent_use_when_openfga_denies(monkeypatch):
    from dynamic_agents.auth import openfga_authz

    async def fake_check(subject: str, agent_id: str) -> bool:
        return False

    monkeypatch.setattr(openfga_authz, "_check_agent_use", fake_check)
    token_ref = current_user_token.set(_fake_jwt({"sub": "alice-sub"}))
    try:
        with pytest.raises(HTTPException) as exc:
            await openfga_authz.require_agent_use_permission("agent-1")
    finally:
        current_user_token.reset(token_ref)

    assert exc.value.status_code == 403
    assert exc.value.detail["reason"] == "pdp_denied"
    assert exc.value.detail["action"] == "contact_admin"


@pytest.mark.asyncio
async def test_logs_openfga_rebac_audit_for_runtime_deny(monkeypatch, caplog):
    from dynamic_agents.auth import openfga_authz

    async def fake_check(subject: str, agent_id: str) -> bool:
        return False

    monkeypatch.setattr(openfga_authz, "_check_agent_use", fake_check)
    token_ref = current_user_token.set(_fake_jwt({"sub": "alice-sub"}))
    with caplog.at_level(logging.INFO, logger="dynamic_agents.auth.openfga_authz"):
        try:
            with pytest.raises(HTTPException):
                await openfga_authz.require_agent_use_permission("agent-1")
        finally:
            current_user_token.reset(token_ref)

    audit = json.loads(caplog.records[-1].message)
    assert audit["type"] == "openfga_rebac"
    assert audit["outcome"] == "deny"
    assert audit["reason_code"] == "DENY_NO_CAPABILITY"


@pytest.mark.asyncio
async def test_fails_closed_when_openfga_is_unavailable(monkeypatch):
    from dynamic_agents.auth import openfga_authz

    async def fake_check(subject: str, agent_id: str) -> bool:
        raise RuntimeError("openfga unavailable")

    monkeypatch.setattr(openfga_authz, "_check_agent_use", fake_check)
    token_ref = current_user_token.set(_fake_jwt({"sub": "alice-sub"}))
    try:
        with pytest.raises(HTTPException) as exc:
            await openfga_authz.require_agent_use_permission("agent-1")
    finally:
        current_user_token.reset(token_ref)

    assert exc.value.status_code == 503
    assert exc.value.detail["reason"] == "pdp_unavailable"
    assert exc.value.detail["action"] == "retry"


@pytest.mark.asyncio
async def test_missing_bearer_returns_structured_401():
    from dynamic_agents.auth import openfga_authz

    with pytest.raises(HTTPException) as exc:
        await openfga_authz.require_agent_use_permission("agent-1")

    assert exc.value.status_code == 401
    assert exc.value.detail["code"] == "missing_bearer"
    assert exc.value.detail["reason"] == "not_signed_in"


@pytest.mark.asyncio
async def test_invalid_token_without_subject_returns_structured_401():
    from dynamic_agents.auth import openfga_authz

    token_ref = current_user_token.set(_fake_jwt({"email": "alice@example.com"}))
    try:
        with pytest.raises(HTTPException) as exc:
            await openfga_authz.require_agent_use_permission("agent-1")
    finally:
        current_user_token.reset(token_ref)

    assert exc.value.status_code == 401
    assert exc.value.detail["code"] == "bearer_invalid"
    assert exc.value.detail["reason"] == "bearer_invalid"


@pytest.mark.asyncio
async def test_invalid_agent_id_returns_structured_400(monkeypatch):
    from dynamic_agents.auth import openfga_authz

    async def fake_check(subject: str, agent_id: str) -> bool:
        raise AssertionError("OpenFGA should not be called for invalid agent ids")

    monkeypatch.setattr(openfga_authz, "_check_agent_use", fake_check)
    token_ref = current_user_token.set(_fake_jwt({"sub": "alice-sub"}))
    try:
        with pytest.raises(HTTPException) as exc:
            await openfga_authz.require_agent_use_permission("../agent-1")
    finally:
        current_user_token.reset(token_ref)

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "invalid_agent_id"
    assert exc.value.detail["reason"] == "invalid_request"


# ── Org-admin bypass (Phase 4: DA agrees with the BFF/CAS) ──────────────────


@pytest.mark.parametrize(
    "raw,enabled",
    [
        (None, True),  # unset → bypass on
        ("", True),
        ("0", True),
        ("false", True),
        ("no", True),
        ("1", False),  # kill-switch values → bypass off
        ("true", False),
        ("TRUE", False),
        ("Yes", False),
    ],
)
def test_org_admin_bypass_enabled_killswitch(monkeypatch, raw, enabled):
    from dynamic_agents.auth import openfga_authz

    monkeypatch.delenv("RAG_ADMIN_BYPASS_DISABLED", raising=False)
    if raw is not None:
        monkeypatch.setenv("RAG_ADMIN_BYPASS_DISABLED", raw)
    assert openfga_authz._org_admin_bypass_enabled() is enabled


@pytest.mark.asyncio
async def test_org_admin_bypass_allows_when_base_check_denies(monkeypatch):
    """An org admin denied by the base agent-use check is allowed via the bypass."""
    from dynamic_agents.auth import openfga_authz

    monkeypatch.delenv("RAG_ADMIN_BYPASS_DISABLED", raising=False)  # bypass on
    bypass_calls: list[str] = []

    async def fake_check(subject: str, agent_id: str) -> bool:
        return False

    async def fake_org_admin(subject: str) -> bool:
        bypass_calls.append(subject)
        return True

    monkeypatch.setattr(openfga_authz, "_check_agent_use", fake_check)
    monkeypatch.setattr(openfga_authz, "_check_org_admin", fake_org_admin)
    token_ref = current_user_token.set(_fake_jwt({"sub": "admin-sub"}))
    try:
        await openfga_authz.require_agent_use_permission("agent-1")  # no raise
    finally:
        current_user_token.reset(token_ref)

    assert bypass_calls == ["admin-sub"]


@pytest.mark.asyncio
async def test_org_admin_bypass_disabled_still_denies(monkeypatch):
    """With the kill-switch set, a denied base check is NOT rescued by the bypass."""
    from dynamic_agents.auth import openfga_authz

    monkeypatch.setenv("RAG_ADMIN_BYPASS_DISABLED", "1")  # bypass off

    async def fake_check(subject: str, agent_id: str) -> bool:
        return False

    async def fake_org_admin(subject: str) -> bool:
        raise AssertionError("org-admin bypass must not run when disabled")

    monkeypatch.setattr(openfga_authz, "_check_agent_use", fake_check)
    monkeypatch.setattr(openfga_authz, "_check_org_admin", fake_org_admin)
    token_ref = current_user_token.set(_fake_jwt({"sub": "admin-sub"}))
    try:
        with pytest.raises(HTTPException) as exc:
            await openfga_authz.require_agent_use_permission("agent-1")
    finally:
        current_user_token.reset(token_ref)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_org_admin_bypass_fails_closed_on_check_error(monkeypatch):
    """If the org-admin check itself errors, the request is denied (fail-closed)."""
    from dynamic_agents.auth import openfga_authz

    monkeypatch.delenv("RAG_ADMIN_BYPASS_DISABLED", raising=False)  # bypass on

    async def fake_check(subject: str, agent_id: str) -> bool:
        return False

    async def fake_org_admin(subject: str) -> bool:
        raise RuntimeError("openfga unavailable")

    monkeypatch.setattr(openfga_authz, "_check_agent_use", fake_check)
    monkeypatch.setattr(openfga_authz, "_check_org_admin", fake_org_admin)
    token_ref = current_user_token.set(_fake_jwt({"sub": "admin-sub"}))
    try:
        with pytest.raises(HTTPException) as exc:
            await openfga_authz.require_agent_use_permission("agent-1")
    finally:
        current_user_token.reset(token_ref)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_check_org_admin_posts_can_manage_organization(monkeypatch):
    """_check_org_admin issues a can_manage check against organization:<CAIPE_ORG_KEY>."""
    from dynamic_agents.auth import openfga_authz

    posts: list[tuple[str, dict]] = []

    class FakeResponse:
        def __init__(self, payload: dict):
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, url: str, **kwargs):
            return FakeResponse({"stores": [{"name": "caipe-openfga", "id": "store-1"}]})

        async def post(self, url: str, **kwargs):
            posts.append((url, kwargs.get("json")))
            return FakeResponse({"allowed": True})

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga:8080")
    monkeypatch.setenv("CAIPE_ORG_KEY", "acme")
    monkeypatch.setattr(openfga_authz.httpx, "AsyncClient", FakeClient)

    assert await openfga_authz._check_org_admin("admin-sub") is True
    assert posts
    _, body = posts[-1]
    assert body["tuple_key"] == {
        "user": "user:admin-sub",
        "relation": "can_manage",
        "object": "organization:acme",
    }
