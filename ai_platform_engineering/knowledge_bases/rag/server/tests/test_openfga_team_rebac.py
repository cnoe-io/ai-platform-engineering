"""Tests for team-derived OpenFGA authorization in the RAG server."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from common.models.rbac import KbPermission, Role, UserContext
from common.models.server import QueryRequest
from server import rbac


def _request(headers: dict[str, str] | None = None) -> SimpleNamespace:
    return SimpleNamespace(headers=headers or {})


def _user(subject: str = "alice-sub", role: str = Role.ANONYMOUS) -> UserContext:
    return UserContext(
        subject=subject,
        email="alice@example.com",
        groups=[],
        role=role,
        is_authenticated=True,
        kb_permissions=[],
        realm_roles=[],
    )


def _privileged_user(email: str, role: str = Role.ADMIN) -> UserContext:
    return UserContext(
        subject=None,
        email=email,
        groups=[],
        role=role,
        is_authenticated=True,
        kb_permissions=[],
        realm_roles=[],
    )


@pytest.mark.asyncio
async def test_accessible_kb_ids_are_loaded_from_openfga_list_objects(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, str]] = []

    async def fake_list_objects(user: UserContext, relation: str, object_type: str) -> list[str]:
        calls.append((user.subject or "", relation, object_type))
        return ["knowledge_base:kb-alpha", "knowledge_base:kb-beta"]

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_list_objects", fake_list_objects, raising=False)

    result = await rbac.get_accessible_kb_ids(_user(), "read", "default", team_id="platform")

    assert set(result) == {"kb-alpha", "kb-beta"}
    assert calls == [("alice-sub", "can_read", "knowledge_base")]


@pytest.mark.asyncio
async def test_accessible_kb_ids_merge_openfga_with_per_kb_roles(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_list_objects(user: UserContext, relation: str, object_type: str) -> list[str]:
        return ["knowledge_base:openfga-kb"]

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_list_objects", fake_list_objects, raising=False)
    user = _user()
    user = user.model_copy(
        update={"kb_permissions": [KbPermission(kb_id="legacy-role-kb", scope="read")]}
    )

    result = await rbac.get_accessible_kb_ids(user, "read", "default", team_id="platform")

    assert set(result) == {"openfga-kb", "legacy-role-kb"}


@pytest.mark.asyncio
async def test_kb_access_check_allows_team_derived_openfga_relation(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, str]] = []

    async def fake_check(user: UserContext, relation: str, object_id: str) -> bool:
        calls.append((user.subject or "", relation, object_id))
        return True

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_check_knowledge_base", fake_check, raising=False)

    await rbac.check_kb_datasource_access(_request({"X-Tenant-Id": "default"}), _user(), "kb-alpha", "read")

    assert calls == [("alice-sub", "can_read", "kb-alpha")]


@pytest.mark.asyncio
async def test_kb_access_check_denies_when_openfga_denies(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_check(user: UserContext, relation: str, object_id: str) -> bool:
        return False

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_check_knowledge_base", fake_check, raising=False)

    with pytest.raises(HTTPException) as exc:
        await rbac.check_kb_datasource_access(_request(), _user(), "kb-alpha", "read")

    assert exc.value.status_code == 403
    assert exc.value.detail == "Access denied for this datasource"


@pytest.mark.asyncio
async def test_kb_access_check_fails_closed_when_openfga_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_check(user: UserContext, relation: str, object_id: str) -> bool:
        raise RuntimeError("openfga down")

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_check_knowledge_base", fake_check, raising=False)

    with pytest.raises(HTTPException) as exc:
        await rbac.check_kb_datasource_access(_request(), _user(), "kb-alpha", "read")

    assert exc.value.status_code == 503
    assert exc.value.detail == "Authorization service is temporarily unavailable"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "user",
    [
        _privileged_user("trusted-network", Role.ADMIN),
        _privileged_user("trusted:webloader:default", Role.ADMIN),
        _privileged_user("client:rag-ingestor", Role.INGESTONLY),
        _privileged_user("admin@example.com", Role.ADMIN),
        _privileged_user("kb-admin@example.com", Role.READONLY).model_copy(update={"realm_roles": ["kb_admin"]}),
    ],
)
async def test_kb_access_check_preserves_unrestricted_principals_when_openfga_is_configured(
    monkeypatch: pytest.MonkeyPatch,
    user: UserContext,
) -> None:
    async def fake_check(user: UserContext, relation: str, object_id: str) -> bool:
        raise AssertionError("unrestricted principals must not call OpenFGA check")

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_check_knowledge_base", fake_check, raising=False)

    await rbac.check_kb_datasource_access(_request(), user, "kb-alpha", "admin")


@pytest.mark.asyncio
async def test_query_filter_is_constrained_to_openfga_readable_datasources(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_list_objects(user: UserContext, relation: str, object_type: str) -> list[str]:
        assert relation == "can_read"
        assert object_type == "knowledge_base"
        return ["knowledge_base:kb-alpha"]

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_list_objects", fake_list_objects, raising=False)

    query = QueryRequest(query="deployments", filters=None)
    empty = await rbac.inject_kb_filter(query, _user(), "default", _request())

    assert empty is False
    assert query.filters == {"datasource_id": "kb-alpha"}
