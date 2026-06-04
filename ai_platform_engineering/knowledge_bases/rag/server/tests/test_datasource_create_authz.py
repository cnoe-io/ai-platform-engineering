"""Tests for explicit data-source author authorization in the RAG server.

Covers ``authorize_datasource_create`` and ``write_datasource_ownership``
(spec 2026-06-03-explicit-ingest-capability). Creating a NEW data source is the
explicit org-level ``can_ingest`` capability plus owning-team membership — NOT
per-KB ingest. On success the server writes ownership tuples so the owning team
immediately gets read/ingest.

assisted-by Cursor claude-opus-4.8
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from common.models.rbac import Role, UserContext
from server import rbac


def _user(subject: str | None = "alice-sub", role: str = Role.READONLY) -> UserContext:
    return UserContext(
        subject=subject,
        email="alice@example.com",
        role=role,
        is_authenticated=True,
        groups=[],
    )


@pytest.fixture(autouse=True)
def _team_scope_on(monkeypatch: pytest.MonkeyPatch) -> None:
    # Enable team-scope ReBAC and a configured PDP for every test here.
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", True, raising=False)
    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga")
    monkeypatch.setenv("CAIPE_ORG_KEY", "caipe")

    async def _no_org_admin(_user: UserContext) -> bool:
        return False

    monkeypatch.setattr(rbac, "_openfga_check_org_admin", _no_org_admin, raising=False)


# ---------------------------------------------------------------------------
# authorize_datasource_create
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_noop_when_team_scope_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", False, raising=False)

    async def _explode(*_a, **_k):  # pragma: no cover - must not run
        raise AssertionError("must not hit the PDP when team-scope is off")

    monkeypatch.setattr(rbac, "_openfga_check_org_admin", _explode, raising=False)
    # No exception == allowed.
    await rbac.authorize_datasource_create(None, _user(), "src_new", "team-a")


@pytest.mark.asyncio
async def test_create_allows_coarse_admin_without_pdp(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _explode(*_a, **_k):  # pragma: no cover - must not run
        raise AssertionError("coarse ADMIN must not hit the PDP")

    monkeypatch.setattr(rbac, "_openfga_check_org_admin", _explode, raising=False)
    await rbac.authorize_datasource_create(None, _user(role=Role.ADMIN), "src_new", None)


@pytest.mark.asyncio
async def test_create_allows_org_admin_without_owner_team(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _is_admin(_user: UserContext) -> bool:
        return True

    monkeypatch.setattr(rbac, "_openfga_check_org_admin", _is_admin, raising=False)
    # Org admin may create a personal source (no owning team).
    await rbac.authorize_datasource_create(None, _user(), "src_new", None)


@pytest.mark.asyncio
async def test_create_rejects_non_admin_without_owner_team() -> None:
    with pytest.raises(HTTPException) as exc:
        await rbac.authorize_datasource_create(None, _user(), "src_new", None)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_create_allows_member_of_opted_in_team(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _is_member(_user, relation, object_type, object_id):
        return relation == "can_use" and object_type == "team" and object_id == "team-a"

    async def _opted_in(user, relation, object_ref):
        return user == "team:team-a#member" and relation == "ingestor"

    monkeypatch.setattr(rbac, "_openfga_check_object", _is_member, raising=False)
    monkeypatch.setattr(rbac, "_openfga_read_tuple_exists", _opted_in, raising=False)
    await rbac.authorize_datasource_create(None, _user(), "src_new", "team-a")


@pytest.mark.asyncio
async def test_create_rejects_member_of_non_opted_in_team(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _is_member(_user, relation, object_type, object_id):
        return True  # member of the team...

    async def _not_opted_in(_user, _relation, _object_ref):
        return False  # ...but team lacks the org capability

    monkeypatch.setattr(rbac, "_openfga_check_object", _is_member, raising=False)
    monkeypatch.setattr(rbac, "_openfga_read_tuple_exists", _not_opted_in, raising=False)
    with pytest.raises(HTTPException) as exc:
        await rbac.authorize_datasource_create(None, _user(), "src_new", "team-a")
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_create_rejects_non_member_even_if_team_opted_in(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _not_member(_user, _relation, _object_type, _object_id):
        return False

    async def _opted_in(_user, _relation, _object_ref):
        return True

    monkeypatch.setattr(rbac, "_openfga_check_object", _not_member, raising=False)
    monkeypatch.setattr(rbac, "_openfga_read_tuple_exists", _opted_in, raising=False)
    with pytest.raises(HTTPException) as exc:
        await rbac.authorize_datasource_create(None, _user(), "src_new", "team-a")
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_create_503_when_pdp_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rbac, "_openfga_http_url", lambda: None, raising=False)
    with pytest.raises(HTTPException) as exc:
        await rbac.authorize_datasource_create(None, _user(), "src_new", "team-a")
    assert exc.value.status_code == 503


# ---------------------------------------------------------------------------
# write_datasource_ownership
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ownership_team_writes_expected_tuples(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[dict[str, str]] = []

    async def _capture(writes):
        captured.extend(writes)

    monkeypatch.setattr(rbac, "_openfga_write_tuples", _capture, raising=False)
    await rbac.write_datasource_ownership("src_x", "team-a", _user(subject="alice-sub"))

    assert {"user": "knowledge_base:src_x", "relation": "parent_kb", "object": "data_source:src_x"} in captured
    assert {"user": "team:team-a#member", "relation": "ingestor", "object": "knowledge_base:src_x"} in captured
    assert {"user": "team:team-a#admin", "relation": "manager", "object": "knowledge_base:src_x"} in captured
    assert {"user": "user:alice-sub", "relation": "creator", "object": "knowledge_base:src_x"} in captured


@pytest.mark.asyncio
async def test_ownership_personal_writes_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[dict[str, str]] = []

    async def _capture(writes):
        captured.extend(writes)

    monkeypatch.setattr(rbac, "_openfga_write_tuples", _capture, raising=False)
    await rbac.write_datasource_ownership("src_x", None, _user(subject="alice-sub"))

    assert {"user": "user:alice-sub", "relation": "owner", "object": "knowledge_base:src_x"} in captured
    assert {"user": "knowledge_base:src_x", "relation": "parent_kb", "object": "data_source:src_x"} in captured
    # No team tuples for a personal source.
    assert not any(t["user"].startswith("team:") for t in captured)


@pytest.mark.asyncio
async def test_ownership_noop_when_team_scope_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rbac, "RBAC_TEAM_SCOPE_ENABLED", False, raising=False)

    async def _explode(_writes):  # pragma: no cover - must not run
        raise AssertionError("must not write when team-scope is off")

    monkeypatch.setattr(rbac, "_openfga_write_tuples", _explode, raising=False)
    await rbac.write_datasource_ownership("src_x", "team-a", _user())


@pytest.mark.asyncio
async def test_ownership_write_failure_is_non_fatal(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _boom(_writes):
        raise RuntimeError("openfga down")

    monkeypatch.setattr(rbac, "_openfga_write_tuples", _boom, raising=False)
    # Must NOT raise — ingestion is already queued.
    await rbac.write_datasource_ownership("src_x", "team-a", _user())
