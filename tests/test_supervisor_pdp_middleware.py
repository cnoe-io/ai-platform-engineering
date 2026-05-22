"""Unit tests for ``SupervisorPdpMiddleware`` (Spec 102 T083 / T084)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from unittest.mock import AsyncMock

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from ai_platform_engineering.utils.auth import supervisor_pdp_middleware as mod
from ai_platform_engineering.utils.auth.token_context import current_bearer_token


@dataclass
class _Decision:
    allowed: bool
    reason: str = "ok"


def _build_app(monkeypatch, *, enabled: bool):
    monkeypatch.setenv(
        "SUPERVISOR_PDP_GATE_ENABLED", "true" if enabled else "false"
    )

    seen: dict[str, bool] = {}

    async def handler(request: Request) -> JSONResponse:
        seen["called"] = True
        return JSONResponse({"ok": True})

    app = Starlette(
        routes=[
            Route("/tasks", handler, methods=["POST", "GET"]),
            Route("/.well-known/agent-card.json", handler, methods=["GET"]),
            Route("/health", handler, methods=["GET"]),
        ]
    )

    class _BindToken:
        async def dispatch(self, scope, receive, send):  # pragma: no cover
            pass

    # Wrap requests with a tiny middleware that binds current_bearer_token
    # from the Authorization header — same contract as JwtUserContextMiddleware.
    from starlette.middleware.base import BaseHTTPMiddleware

    class _BindBearer(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            authz = request.headers.get("authorization", "")
            tok = authz[7:] if authz.lower().startswith("bearer ") else None
            t = current_bearer_token.set(tok)
            try:
                return await call_next(request)
            finally:
                current_bearer_token.reset(t)

    app.add_middleware(mod.SupervisorPdpMiddleware)
    app.add_middleware(_BindBearer)
    return app, seen


def test_disabled_is_noop(monkeypatch):
    app, seen = _build_app(monkeypatch, enabled=False)
    with TestClient(app) as client:
        r = client.post("/tasks")
    assert r.status_code == 200
    assert seen.get("called") is True


def test_enabled_get_request_passes_through_without_pdp(monkeypatch):
    """GET is not state-changing; the middleware must not block it."""
    app, seen = _build_app(monkeypatch, enabled=True)
    with TestClient(app) as client:
        r = client.get("/tasks")
    assert r.status_code == 200
    assert seen.get("called") is True


def test_enabled_public_path_bypasses_gate(monkeypatch):
    app, seen = _build_app(monkeypatch, enabled=True)
    with TestClient(app) as client:
        r = client.get("/.well-known/agent-card.json")
        r2 = client.get("/health")
    assert r.status_code == 200
    assert r2.status_code == 200


def test_enabled_no_bearer_returns_401(monkeypatch):
    app, _ = _build_app(monkeypatch, enabled=True)
    with TestClient(app) as client:
        r = client.post("/tasks")
    assert r.status_code == 401
    body = json.loads(r.text)
    assert body["code"] == "missing_bearer"
    assert body["action"] == "sign_in"


def test_enabled_pdp_allow_calls_handler(monkeypatch):
    app, seen = _build_app(monkeypatch, enabled=True)
    monkeypatch.setattr(
        "ai_platform_engineering.utils.auth.keycloak_authz.require_rbac_permission",
        AsyncMock(return_value=_Decision(allowed=True)),
    )
    with TestClient(app) as client:
        r = client.post("/tasks", headers={"Authorization": "Bearer good"})
    assert r.status_code == 200
    assert seen.get("called") is True


def test_enabled_pdp_deny_returns_403_with_structured_body(monkeypatch):
    app, seen = _build_app(monkeypatch, enabled=True)
    monkeypatch.setattr(
        "ai_platform_engineering.utils.auth.keycloak_authz.require_rbac_permission",
        AsyncMock(return_value=_Decision(allowed=False, reason="missing_role")),
    )
    with TestClient(app) as client:
        r = client.post("/tasks", headers={"Authorization": "Bearer good"})
    assert r.status_code == 403
    body = json.loads(r.text)
    assert body["code"] == "rbac_denied"
    assert body["action"] == "contact_admin"
    assert body["reason"] == "missing_role"
    assert body["resource"] == "supervisor"
    assert body["scope"] == "invoke"
    assert seen.get("called") is None


def test_enabled_pdp_exception_returns_503(monkeypatch):
    app, _ = _build_app(monkeypatch, enabled=True)
    monkeypatch.setattr(
        "ai_platform_engineering.utils.auth.keycloak_authz.require_rbac_permission",
        AsyncMock(side_effect=RuntimeError("kc down")),
    )
    with TestClient(app) as client:
        r = client.post("/tasks", headers={"Authorization": "Bearer good"})
    assert r.status_code == 503
    body = json.loads(r.text)
    assert body["code"] == "pdp_unavailable"
    assert body["action"] == "retry"


@pytest.mark.parametrize("env_val", ["1", "true", "TRUE", "yes"])
def test_enabled_flag_truthy_values(monkeypatch, env_val):
    monkeypatch.setenv("SUPERVISOR_PDP_GATE_ENABLED", env_val)
    assert mod._is_enabled()


@pytest.mark.parametrize("env_val", ["", "0", "false", "no", "off"])
def test_enabled_flag_falsy_values(monkeypatch, env_val):
    monkeypatch.setenv("SUPERVISOR_PDP_GATE_ENABLED", env_val)
    assert not mod._is_enabled()
