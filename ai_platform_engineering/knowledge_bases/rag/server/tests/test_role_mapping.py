"""Tests for identity-only human auth."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from common.models.rbac import Role
from server import rbac


class NoopAuthManager:
    async def validate_token(self, _token):
        raise AssertionError("validate_token should not be called without a bearer token")


def _request(headers: dict[str, str] | None = None) -> SimpleNamespace:
    return SimpleNamespace(headers=headers or {})


def test_trusted_network_auth_path_is_absent() -> None:
    assert not hasattr(rbac, "is_trusted_request")


@pytest.mark.asyncio
async def test_missing_bearer_token_does_not_satisfy_required_auth():
    with pytest.raises(HTTPException) as exc:
        await rbac.require_authenticated_user(_request(), NoopAuthManager())

    assert exc.value.status_code == 401
    assert "Missing Authorization header" in exc.value.detail


def test_anonymous_user_context_path_is_absent() -> None:
    assert not hasattr(rbac, "get_user_or_anonymous")


@pytest.mark.parametrize(
    "claim_name",
    [
        "groups",
        "realm_roles",
        "kb_permissions",
    ],
)
def test_static_identity_claims_are_not_part_of_user_context(claim_name: str) -> None:
    user = rbac.UserContext(
        subject="user-sub",
        email="sri@example.com",
        role=Role.READONLY,
        is_authenticated=True,
    )

    assert user.role == Role.READONLY
    assert not hasattr(user, claim_name)
