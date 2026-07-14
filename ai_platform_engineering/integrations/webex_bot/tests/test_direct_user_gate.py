"""Deployment-user access controls for Webex 1:1 messages."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Optional

from ai_platform_engineering.integrations.webex_bot.app import (
    REASON_DISPATCH_ALLOWED,
    REASON_DM_NOT_ONBOARDED,
    REASON_USER_NOT_LINKED,
    WebexMessageResult,
    handle_webex_message,
    parse_webex_event,
)
from ai_platform_engineering.integrations.webex_bot.utils.dm_authz_client import (
    DmAgentAccessDecision,
)
from ai_platform_engineering.integrations.webex_bot.utils.obo_exchange import OboToken
from ai_platform_engineering.integrations.webex_bot.utils.webex_direct_users import (
    WebexDirectUserAccess,
)


def _event() -> dict[str, Any]:
    return {
        "personId": "person1234",
        "personEmail": "user@example.com",
        "roomId": "space12345",
        "roomType": "direct",
        "botId": "secondary",
        "text": "hello",
    }


@dataclass
class _DirectUsers:
    access: WebexDirectUserAccess
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def resolve(self, **kwargs: Any) -> WebexDirectUserAccess:
        self.calls.append(kwargs)
        return self.access


@dataclass
class _Identity:
    user_id: Optional[str] = "kc-user-1"
    resolve_calls: int = 0
    link_calls: int = 0

    async def resolve(self, webex_user_id: str) -> Optional[str]:
        self.resolve_calls += 1
        return self.user_id

    async def linking_url(self, webex_user_id: str) -> Optional[str]:
        self.link_calls += 1
        return "https://ui.example/link"


class _Obo:
    async def impersonate(self, keycloak_user_id: str) -> OboToken:
        return OboToken(access_token="obo-token", token_type="Bearer", expires_in=300)


@dataclass
class _DmAuthz:
    allowed: bool = True
    available: bool = True
    calls: list[dict[str, str]] = field(default_factory=list)

    def check_agent_access(self, **kwargs: str) -> DmAgentAccessDecision:
        self.calls.append(kwargs)
        return DmAgentAccessDecision(
            allowed=self.allowed,
            reason="ALLOW" if self.allowed else "DENY_AGENT",
            path="user",
            available=self.available,
            matched_team_slug=None,
        )


class _NeverTeam:
    async def resolve(self, bot_id: str, space_id: str):
        del bot_id, space_id
        raise AssertionError("DMs must not use group-space team routing")


class _NeverRoutes:
    async def resolve_route(self, **kwargs: Any):
        raise AssertionError("DMs must use the onboarded direct-user agent")


class _NeverSpaceGrant:
    def check_space_grant(self, **kwargs: Any):
        raise AssertionError("DMs must not use a group-space grant")


async def _dispatch(calls: list[dict[str, Any]], payload: dict[str, Any]) -> None:
    calls.append(payload)


def _run(
    direct_users: _DirectUsers,
    identity: _Identity,
    *,
    dm_authz: _DmAuthz | None = None,
    dispatch_calls: list[dict[str, Any]] | None = None,
) -> WebexMessageResult:
    calls = dispatch_calls if dispatch_calls is not None else []
    return asyncio.run(
        handle_webex_message(
            _event(),
            direct_user_resolver=direct_users,
            identity_linker=identity,
            team_resolver=_NeverTeam(),
            obo_exchanger=_Obo(),
            route_resolver=_NeverRoutes(),
            rebac_checker=_NeverSpaceGrant(),
            dm_authz_checker=dm_authz or _DmAuthz(),
            dispatcher=lambda payload: _dispatch(calls, payload),
        )
    )


def test_unonboarded_direct_user_is_silently_ignored_before_identity_linking(monkeypatch) -> None:
    monkeypatch.delenv("WEBEX_WORKSPACE_ALIAS", raising=False)
    monkeypatch.delenv("WEBEX_WORKSPACE_ID", raising=False)
    identity = _Identity()
    result = _run(
        _DirectUsers(WebexDirectUserAccess(False, None, None, "not_onboarded")),
        identity,
    )

    assert result.ignored is True
    assert result.reason_code == REASON_DM_NOT_ONBOARDED
    assert result.deny_message is None
    assert identity.resolve_calls == 0
    assert identity.link_calls == 0


def test_onboarded_unlinked_user_receives_identity_link() -> None:
    identity = _Identity(user_id=None)
    result = _run(
        _DirectUsers(WebexDirectUserAccess(True, "kc-user-1", "agent-1", "allowlist_route")),
        identity,
    )

    assert result.reason_code == REASON_USER_NOT_LINKED
    assert result.linking_url == "https://ui.example/link"


def test_onboarded_direct_user_dispatches_selected_agent_with_user_obo() -> None:
    calls: list[dict[str, Any]] = []
    authz = _DmAuthz()
    direct_users = _DirectUsers(
        WebexDirectUserAccess(True, "kc-user-1", "agent-1", "allowlist_route")
    )
    result = _run(direct_users, _Identity(), dm_authz=authz, dispatch_calls=calls)

    assert result.reason_code == REASON_DISPATCH_ALLOWED
    assert result.dispatched is True
    assert direct_users.calls == [{
        "bot_id": "secondary",
        "webex_user_id": "person1234",
        "person_email": "user@example.com",
    }]
    assert authz.calls == [{"agent_id": "agent-1", "bearer_token": "obo-token"}]
    assert calls[0]["agent_id"] == "agent-1"
    assert calls[0]["bot_id"] == "secondary"
    assert calls[0]["keycloak_user_id"] == "kc-user-1"
    assert calls[0]["team_slug"] is None


def test_linked_identity_must_match_onboarded_deployment_user() -> None:
    result = _run(
        _DirectUsers(WebexDirectUserAccess(True, "kc-user-2", "agent-1", "allowlist_route")),
        _Identity(user_id="kc-user-1"),
    )

    assert result.ignored is True
    assert result.reason_code == REASON_DM_NOT_ONBOARDED


def test_direct_agent_still_requires_user_openfga_access() -> None:
    result = _run(
        _DirectUsers(WebexDirectUserAccess(True, "kc-user-1", "agent-1", "allowlist_route")),
        _Identity(),
        dm_authz=_DmAuthz(allowed=False),
    )

    assert result.allowed is False
    assert result.reason_code == "DENY_AGENT"


def test_parser_carries_direct_identity_and_bot() -> None:
    parsed = parse_webex_event(_event())
    assert parsed is not None
    assert parsed.is_direct is True
    assert parsed.person_email == "user@example.com"
    assert parsed.bot_id == "secondary"
