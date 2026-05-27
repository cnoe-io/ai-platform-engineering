"""Tests for team-derived OpenFGA authorization in the RAG server."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from common.models.rbac import Role, UserContext
from common.models.server import QueryRequest
from server import rbac


def _request(headers: dict[str, str] | None = None) -> SimpleNamespace:
    return SimpleNamespace(headers=headers or {})


def _user(subject: str = "alice-sub", role: str = Role.READONLY) -> UserContext:
    return UserContext(
        subject=subject,
        email="alice@example.com",
        role=role,
        is_authenticated=True,
        groups=[],
    )


def _privileged_user(email: str, role: str = Role.ADMIN) -> UserContext:
    return UserContext(
        subject=None,
        email=email,
        role=role,
        is_authenticated=True,
        groups=[],
    )


@pytest.fixture(autouse=True)
def _default_no_org_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_check_object(
        user: UserContext,
        relation: str,
        object_type: str,
        object_id: str,
    ) -> bool:
        return False

    monkeypatch.setattr(rbac, "_openfga_check_object", fake_check_object, raising=False)


@pytest.mark.asyncio
async def test_accessible_datasource_ids_are_loaded_from_openfga_list_objects(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, str]] = []

    async def fake_list_objects(user: UserContext, relation: str, object_type: str) -> list[str]:
        calls.append((user.subject or "", relation, object_type))
        return ["data_source:kb-alpha", "data_source:kb-beta"]

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_list_objects", fake_list_objects, raising=False)

    result = await rbac.get_accessible_datasource_ids(_user(), "read", "default", team_id="platform")

    assert set(result) == {"kb-alpha", "kb-beta"}
    assert calls == [("alice-sub", "can_read", "data_source")]


@pytest.mark.asyncio
async def test_accessible_datasource_ids_come_from_openfga(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_list_objects(user: UserContext, relation: str, object_type: str) -> list[str]:
        return ["data_source:openfga-ds"]

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_list_objects", fake_list_objects, raising=False)
    result = await rbac.get_accessible_datasource_ids(_user(), "read", "default", team_id="platform")

    assert set(result) == {"openfga-ds"}


@pytest.mark.asyncio
async def test_accessible_datasource_ids_allow_org_admin_super_grant(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_list_objects(user: UserContext, relation: str, object_type: str) -> list[str]:
        return []

    async def fake_check_object(
        user: UserContext,
        relation: str,
        object_type: str,
        object_id: str,
    ) -> bool:
        return object_type == "organization" and relation == "can_manage" and object_id == "caipe"

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setenv("CAIPE_ORG_KEY", "caipe")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_list_objects", fake_list_objects, raising=False)
    monkeypatch.setattr(rbac, "_openfga_check_object", fake_check_object, raising=False)

    result = await rbac.get_accessible_datasource_ids(_user(), "read", "default", team_id="platform")

    assert result == ["*"]


@pytest.mark.asyncio
async def test_datasource_access_check_allows_data_source_relation(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, str]] = []

    async def fake_check(user: UserContext, relation: str, object_id: str) -> bool:
        calls.append((user.subject or "", relation, object_id))
        return True

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_check_data_source", fake_check, raising=False)

    await rbac.check_datasource_access(_request({"X-Tenant-Id": "default"}), _user(), "kb-alpha", "read")

    assert calls == [("alice-sub", "can_read", "kb-alpha")]


@pytest.mark.asyncio
async def test_kb_access_check_denies_when_openfga_denies(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_check(user: UserContext, relation: str, object_id: str) -> bool:
        return False

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_check_data_source", fake_check, raising=False)

    with pytest.raises(HTTPException) as exc:
        await rbac.check_datasource_access(_request(), _user(), "kb-alpha", "read")

    assert exc.value.status_code == 403
    assert exc.value.detail == "Access denied for this datasource"


@pytest.mark.asyncio
async def test_kb_access_check_allows_org_admin_super_grant(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, str, str]] = []

    async def fake_check_data_source(user: UserContext, relation: str, object_id: str) -> bool:
        calls.append(("data_source", user.subject or "", relation, object_id))
        return False

    async def fake_check_object(
        user: UserContext,
        relation: str,
        object_type: str,
        object_id: str,
    ) -> bool:
        calls.append((object_type, user.subject or "", relation, object_id))
        return object_type == "organization" and relation == "can_manage" and object_id == "caipe"

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setenv("CAIPE_ORG_KEY", "caipe")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_check_data_source", fake_check_data_source, raising=False)
    monkeypatch.setattr(rbac, "_openfga_check_object", fake_check_object, raising=False)

    await rbac.check_datasource_access(_request(), _user(), "new-datasource", "ingest")

    assert calls == [
        ("data_source", "alice-sub", "can_ingest", "new-datasource"),
        ("organization", "alice-sub", "can_manage", "caipe"),
    ]


@pytest.mark.asyncio
async def test_kb_access_check_fails_closed_when_openfga_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_check(user: UserContext, relation: str, object_id: str) -> bool:
        raise RuntimeError("openfga down")

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_check_data_source", fake_check, raising=False)

    with pytest.raises(HTTPException) as exc:
        await rbac.check_datasource_access(_request(), _user(), "kb-alpha", "read")

    assert exc.value.status_code == 503
    assert exc.value.detail == "Authorization service is temporarily unavailable"


@pytest.mark.asyncio
async def test_kb_access_check_fails_closed_when_openfga_is_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENFGA_HTTP", raising=False)
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)

    with pytest.raises(HTTPException) as exc:
        await rbac.check_datasource_access(_request(), _user(), "kb-alpha", "read")

    assert exc.value.status_code == 503
    assert exc.value.detail == "Authorization service is temporarily unavailable"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "user",
    [
        _privileged_user("client:rag-ingestor", Role.INGESTONLY),
    ],
)
async def test_kb_access_check_preserves_client_credentials_unrestricted_access(
    monkeypatch: pytest.MonkeyPatch,
    user: UserContext,
) -> None:
    async def fake_check(user: UserContext, relation: str, object_id: str) -> bool:
        raise AssertionError("unrestricted principals must not call OpenFGA check")

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_check_data_source", fake_check, raising=False)

    await rbac.check_datasource_access(_request(), user, "kb-alpha", "admin")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "user",
    [
        _privileged_user("admin@example.com", Role.ADMIN),
    ],
)
async def test_human_principals_must_pass_openfga(
    monkeypatch: pytest.MonkeyPatch,
    user: UserContext,
) -> None:
    calls: list[tuple[str, str, str]] = []

    async def fake_check(user: UserContext, relation: str, object_id: str) -> bool:
        calls.append((user.email, relation, object_id))
        return False

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_check_data_source", fake_check, raising=False)

    with pytest.raises(HTTPException) as exc:
        await rbac.check_datasource_access(_request(), user, "kb-alpha", "admin")

    assert exc.value.status_code == 403
    assert calls == [(user.email, "can_manage", "kb-alpha")]


@pytest.mark.asyncio
async def test_query_filter_is_constrained_to_openfga_readable_datasources(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_list_objects(user: UserContext, relation: str, object_type: str) -> list[str]:
        assert relation == "can_read"
        assert object_type == "data_source"
        return ["data_source:kb-alpha"]

    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True)
    monkeypatch.setattr(rbac, "_openfga_list_objects", fake_list_objects, raising=False)

    query = QueryRequest(query="deployments", filters=None)
    empty = await rbac.inject_kb_filter(query, _user(), "default", _request())

    assert empty is False
    assert query.filters == {"datasource_id": "kb-alpha"}
