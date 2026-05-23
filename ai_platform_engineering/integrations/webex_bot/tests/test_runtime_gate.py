# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for the Webex message runtime gate."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Optional

from ai_platform_engineering.integrations.webex_bot.app import (
    REASON_DISPATCH_ALLOWED,
    REASON_IGNORED_BOT,
    REASON_IGNORED_MALFORMED,
    REASON_IGNORED_SELF,
    REASON_OBO_FAILED,
    REASON_SPACE_TEAM_NOT_FOUND,
    REASON_USER_NOT_LINKED,
    WebexRouteResolution,
    handle_webex_message,
)
from ai_platform_engineering.integrations.webex_bot.utils.obo_exchange import OboToken
from ai_platform_engineering.integrations.webex_bot.utils.space_team_resolver import (
    SpaceTeamResolution,
)
from ai_platform_engineering.integrations.webex_bot.utils.webex_rebac import (
    WebexSpaceRebacDecision,
)


def _event(
    *,
    person_id: str = "person1234",
    space_id: str = "space12345",
    text: str = "hello",
    is_bot: bool = False,
) -> dict[str, Any]:
    return {
        "person_id": person_id,
        "space_id": space_id,
        "text": text,
        "is_bot": is_bot,
    }


@dataclass
class FakeIdentityLinker:
    linked: bool = True
    keycloak_user_id: str = "kc-user-1"
    linking_url_value: str = "https://ui.example/api/auth/webex-link?x=1"

    async def resolve(self, webex_user_id: str) -> Optional[str]:
        return self.keycloak_user_id if self.linked else None

    async def linking_url(self, webex_user_id: str) -> Optional[str]:
        return self.linking_url_value if not self.linked else None


@dataclass
class FakeTeamResolver:
    team_slug: Optional[str] = "platform-eng"
    deny_message: Optional[str] = None

    async def resolve(self, space_id: str, keycloak_user_id: str) -> SpaceTeamResolution:
        return SpaceTeamResolution(
            team_slug=self.team_slug,
            team_id="team-mongo-id" if self.team_slug else None,
            team_name="Platform Eng" if self.team_slug else None,
            deny_message=self.deny_message,
        )


@dataclass
class FakeOboExchanger:
    fail: bool = False

    async def impersonate(self, keycloak_user_id: str, *, active_team: str) -> OboToken:
        if self.fail:
            from ai_platform_engineering.integrations.webex_bot.utils.obo_exchange import (
                OboExchangeError,
            )

            raise OboExchangeError("exchange failed")
        return OboToken(
            access_token="obo-access",
            token_type="Bearer",
            expires_in=300,
            active_team=active_team,
        )


@dataclass
class FakeRebacChecker:
    allowed: bool = True
    reason: str = "allowed"

    def check_agent_access(self, **kwargs: Any) -> WebexSpaceRebacDecision:
        return WebexSpaceRebacDecision(
            allowed=self.allowed,
            space_allowed=self.allowed,
            user_allowed=self.allowed,
            reason=self.reason,  # type: ignore[arg-type]
        )


@dataclass
class FakeRouteResolver:
    agent_id: Optional[str] = "agent-1"

    async def resolve_route(self, **kwargs: Any) -> WebexRouteResolution:
        if not self.agent_id:
            return WebexRouteResolution(
                agent_id=None,
                deny_message="No route configured",
            )
        return WebexRouteResolution(agent_id=self.agent_id)


class FakeDispatcher:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, payload: dict[str, Any]) -> None:
        self.calls.append(payload)


def test_unlinked_webex_user_denies_before_dispatch() -> None:
    dispatcher = FakeDispatcher()
    result = asyncio.run(
        handle_webex_message(
            _event(),
            identity_linker=FakeIdentityLinker(linked=False),
            dispatcher=dispatcher,
        )
    )
    assert result.allowed is False
    assert result.reason_code == REASON_USER_NOT_LINKED
    assert result.linking_url == "https://ui.example/api/auth/webex-link?x=1"
    assert dispatcher.calls == []


def test_linked_allowed_dispatches() -> None:
    dispatcher = FakeDispatcher()
    result = asyncio.run(
        handle_webex_message(
            _event(),
            identity_linker=FakeIdentityLinker(),
            team_resolver=FakeTeamResolver(),
            obo_exchanger=FakeOboExchanger(),
            rebac_checker=FakeRebacChecker(),
            route_resolver=FakeRouteResolver(agent_id="incident-agent"),
            dispatcher=dispatcher,
        )
    )
    assert result.allowed is True
    assert result.dispatched is True
    assert result.reason_code == REASON_DISPATCH_ALLOWED
    assert len(dispatcher.calls) == 1
    assert dispatcher.calls[0]["obo_token"] == "obo-access"
    assert dispatcher.calls[0]["agent_id"] == "incident-agent"
    assert dispatcher.calls[0]["active_team"] == "platform-eng"


def test_missing_team_mapping_denies() -> None:
    dispatcher = FakeDispatcher()
    result = asyncio.run(
        handle_webex_message(
            _event(),
            identity_linker=FakeIdentityLinker(),
            team_resolver=FakeTeamResolver(
                team_slug=None,
                deny_message="Space not mapped",
            ),
            dispatcher=dispatcher,
        )
    )
    assert result.reason_code == REASON_SPACE_TEAM_NOT_FOUND
    assert dispatcher.calls == []


def test_obo_failure_denies() -> None:
    dispatcher = FakeDispatcher()
    result = asyncio.run(
        handle_webex_message(
            _event(),
            identity_linker=FakeIdentityLinker(),
            team_resolver=FakeTeamResolver(),
            obo_exchanger=FakeOboExchanger(fail=True),
            dispatcher=dispatcher,
        )
    )
    assert result.reason_code == REASON_OBO_FAILED
    assert result.deny_message is not None
    assert "I couldn't start your CAIPE session for this Webex space." in result.deny_message
    for internal_term in ("Keycloak", "scope", "team-scoped", "provisioned", "slug"):
        assert internal_term not in result.deny_message
    assert dispatcher.calls == []


def test_pdp_unavailable_denies_before_dispatch() -> None:
    dispatcher = FakeDispatcher()
    result = asyncio.run(
        handle_webex_message(
            _event(),
            identity_linker=FakeIdentityLinker(),
            team_resolver=FakeTeamResolver(),
            obo_exchanger=FakeOboExchanger(),
            rebac_checker=FakeRebacChecker(allowed=False, reason="pdp_unavailable"),
            route_resolver=FakeRouteResolver(),
            dispatcher=dispatcher,
        )
    )
    assert result.allowed is False
    assert result.reason_code == "pdp_unavailable"
    assert result.rebac_reason == "pdp_unavailable"
    assert dispatcher.calls == []


def test_rebac_denial_preserves_reason_category() -> None:
    dispatcher = FakeDispatcher()
    result = asyncio.run(
        handle_webex_message(
            _event(),
            identity_linker=FakeIdentityLinker(),
            team_resolver=FakeTeamResolver(),
            obo_exchanger=FakeOboExchanger(),
            rebac_checker=FakeRebacChecker(allowed=False, reason="missing_user_grant"),
            route_resolver=FakeRouteResolver(),
            dispatcher=dispatcher,
        )
    )
    assert result.allowed is False
    assert result.reason_code == "missing_user_grant"
    assert result.rebac_reason == "missing_user_grant"
    assert dispatcher.calls == []


def test_ignored_bot_self_and_malformed_events() -> None:
    dispatcher = FakeDispatcher()

    bot = asyncio.run(
        handle_webex_message(
            _event(is_bot=True),
            identity_linker=FakeIdentityLinker(),
            dispatcher=dispatcher,
        )
    )
    assert bot.ignored is True
    assert bot.reason_code == REASON_IGNORED_BOT

    self_msg = asyncio.run(
        handle_webex_message(
            _event(person_id="botperson1"),
            bot_person_id="botperson1",
            identity_linker=FakeIdentityLinker(),
            dispatcher=dispatcher,
        )
    )
    assert self_msg.ignored is True
    assert self_msg.reason_code == REASON_IGNORED_SELF

    malformed = asyncio.run(
        handle_webex_message(
            {"text": "no ids"},
            identity_linker=FakeIdentityLinker(),
            dispatcher=dispatcher,
        )
    )
    assert malformed.ignored is True
    assert malformed.reason_code == REASON_IGNORED_MALFORMED
    assert dispatcher.calls == []
