# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for the Webex message runtime gate."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Optional

from ai_platform_engineering.integrations.webex_bot.app import (
    REASON_COMMAND_HANDLED,
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
from ai_platform_engineering.integrations.webex_bot.utils.dm_authz_client import (
    DmAgentAccessDecision,
)
from ai_platform_engineering.integrations.webex_bot.utils.dm_thread_overrides import (
    OverrideStore,
)
from ai_platform_engineering.integrations.webex_bot.utils.obo_exchange import OboToken
from ai_platform_engineering.integrations.webex_bot.utils.space_team_resolver import (
    SpaceTeamResolution,
)
from ai_platform_engineering.integrations.webex_bot.utils.user_preferences_client import (
    UserPreferenceResult,
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

    async def resolve(self, space_id: str) -> SpaceTeamResolution:
        return SpaceTeamResolution(
            team_slug=self.team_slug,
            team_id="team-mongo-id" if self.team_slug else None,
            team_name="Platform Eng" if self.team_slug else None,
            deny_message=self.deny_message,
        )


@dataclass
class FakeOboExchanger:
    fail: bool = False

    async def impersonate(self, keycloak_user_id: str) -> OboToken:
        if self.fail:
            from ai_platform_engineering.integrations.webex_bot.utils.obo_exchange import (
                OboExchangeError,
            )

            raise OboExchangeError("exchange failed")
        # Phase 3 (spec 2026-05-24): the OBO token is team-agnostic. Tests
        # that assert team binding look at the dispatch payload's
        # ``team_slug`` (set by the runtime gate from the space resolver),
        # not the token itself.
        return OboToken(
            access_token="obo-access",
            token_type="Bearer",
            expires_in=300,
        )


@dataclass
class FakeRebacChecker:
    allowed: bool = True
    reason: str = "allowed"

    def check_space_grant(self, **kwargs: Any) -> WebexSpaceRebacDecision:
        return WebexSpaceRebacDecision(
            allowed=self.allowed,
            space_allowed=self.allowed,
            reason=self.reason,  # type: ignore[arg-type]
        )


@dataclass
class FakeRouteResolver:
    agent_id: Optional[str] = "agent-1"
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def resolve_route(self, **kwargs: Any) -> WebexRouteResolution:
        self.calls.append(kwargs)
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
    assert dispatcher.calls[0]["team_slug"] == "platform-eng"


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
            rebac_checker=FakeRebacChecker(allowed=False, reason="missing_space_grant"),
            route_resolver=FakeRouteResolver(),
            dispatcher=dispatcher,
        )
    )
    assert result.allowed is False
    assert result.reason_code == "missing_space_grant"
    assert result.rebac_reason == "missing_space_grant"
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


# ---------------------------------------------------------------------------
# Phase 2 (spec 2026-05-24 T153): command handler short-circuit.
# ---------------------------------------------------------------------------


@dataclass
class _FakeCommandHandler:
    intercept: bool = True
    code: str = "help"
    calls: int = 0
    last_bearer: Optional[str] = None

    async def maybe_handle(self, *, parsed: Any, keycloak_user_id: str, bearer_token: str):
        self.calls += 1
        self.last_bearer = bearer_token
        if not self.intercept:
            return None

        class _Result:
            pass

        r = _Result()
        r.code = self.code  # type: ignore[attr-defined]
        return r


def test_command_handler_short_circuits_dispatch() -> None:
    """When the handler returns a sentinel the gate must NOT route or
    dispatch — even if a route+ReBAC would have failed otherwise.
    """
    dispatcher = FakeDispatcher()
    handler = _FakeCommandHandler(intercept=True, code="help")
    result = asyncio.run(
        handle_webex_message(
            _event(text="help"),
            identity_linker=FakeIdentityLinker(),
            team_resolver=FakeTeamResolver(),
            obo_exchanger=FakeOboExchanger(),
            # Route resolver that WOULD fail; should never run.
            route_resolver=FakeRouteResolver(agent_id=None),
            # ReBAC that WOULD deny; should never run.
            rebac_checker=FakeRebacChecker(allowed=False, reason="should_not_be_called"),
            command_handler=handler,
            dispatcher=dispatcher,
        )
    )
    assert handler.calls == 1
    assert handler.last_bearer == "obo-access"
    assert result.allowed is True
    assert result.dispatched is False
    assert result.reason_code == REASON_COMMAND_HANDLED
    assert dispatcher.calls == []


def test_command_handler_falls_through_for_non_command_text() -> None:
    """When the handler returns ``None`` the gate must continue with
    its normal route + ReBAC + dispatch path."""
    dispatcher = FakeDispatcher()
    handler = _FakeCommandHandler(intercept=False)
    result = asyncio.run(
        handle_webex_message(
            _event(text="actual chat"),
            identity_linker=FakeIdentityLinker(),
            team_resolver=FakeTeamResolver(),
            obo_exchanger=FakeOboExchanger(),
            rebac_checker=FakeRebacChecker(),
            route_resolver=FakeRouteResolver(agent_id="incident-agent"),
            command_handler=handler,
            dispatcher=dispatcher,
        )
    )
    assert handler.calls == 1
    assert result.allowed is True
    assert result.dispatched is True
    assert result.reason_code == REASON_DISPATCH_ALLOWED
    assert len(dispatcher.calls) == 1


def test_command_handler_exception_falls_through() -> None:
    """A crash in the command handler must NEVER block a normal message."""
    class _BrokenHandler:
        async def maybe_handle(self, **_: object) -> None:
            raise RuntimeError("handler crashed")

    dispatcher = FakeDispatcher()
    result = asyncio.run(
        handle_webex_message(
            _event(text="help"),
            identity_linker=FakeIdentityLinker(),
            team_resolver=FakeTeamResolver(),
            obo_exchanger=FakeOboExchanger(),
            rebac_checker=FakeRebacChecker(),
            route_resolver=FakeRouteResolver(agent_id="incident-agent"),
            command_handler=_BrokenHandler(),
            dispatcher=dispatcher,
        )
    )
    # Fell through to normal dispatch because the handler crashed.
    assert result.allowed is True
    assert result.dispatched is True
    assert result.reason_code == REASON_DISPATCH_ALLOWED


def test_parsed_webex_event_carries_is_direct_flag() -> None:
    """``roomType=="direct"`` must be propagated into ``ParsedWebexEvent``
    so downstream handlers (commands + DM resolver) can refuse to change
    behavior in a shared group space."""
    from ai_platform_engineering.integrations.webex_bot.app import parse_webex_event

    direct = parse_webex_event(
        {
            "person_id": "person1234",
            "space_id": "space12345",
            "text": "use github",
            "roomType": "direct",
        }
    )
    assert direct is not None
    assert direct.is_direct is True

    group = parse_webex_event(
        {
            "person_id": "person1234",
            "space_id": "space12345",
            "text": "use github",
            "roomType": "group",
        }
    )
    assert group is not None
    assert group.is_direct is False

    unspecified = parse_webex_event(
        {
            "person_id": "person1234",
            "space_id": "space12345",
            "text": "hello",
        }
    )
    assert unspecified is not None
    assert unspecified.is_direct is False


def test_direct_webex_event_passes_direct_flag_to_route_resolver() -> None:
    route_resolver = FakeRouteResolver(agent_id="incident-agent")
    dispatcher = FakeDispatcher()
    result = asyncio.run(
        handle_webex_message(
            _event(text="howdy") | {"roomType": "direct"},
            identity_linker=FakeIdentityLinker(),
            team_resolver=FakeTeamResolver(),
            obo_exchanger=FakeOboExchanger(),
            rebac_checker=FakeRebacChecker(),
            route_resolver=route_resolver,
            dispatcher=dispatcher,
        )
    )

    assert result.allowed is True
    assert result.dispatched is True
    assert route_resolver.calls[0]["is_direct"] is True
    assert dispatcher.calls[0]["agent_id"] == "incident-agent"


def test_default_direct_route_uses_webex_preference(monkeypatch) -> None:
    import ai_platform_engineering.integrations.webex_bot.app as app_module

    class _Preferences:
        def get_dm_default_agent(self, *, bearer_token: str) -> UserPreferenceResult:
            assert bearer_token == "obo-access"
            return UserPreferenceResult(agent_id="personal-webex-agent", source="saved")

    class _Authz:
        def check_agent_access(
            self, *, agent_id: str, bearer_token: str
        ) -> DmAgentAccessDecision:
            assert agent_id == "personal-webex-agent"
            assert bearer_token == "obo-access"
            return DmAgentAccessDecision(
                allowed=True,
                reason="ALLOW",
                path="direct_user_grant",
                available=True,
                matched_team_slug=None,
            )

    monkeypatch.setattr(app_module, "_user_preferences_client", _Preferences())
    monkeypatch.setattr(app_module, "_dm_authz_client", _Authz())
    monkeypatch.setattr(
        app_module,
        "get_default_override_store",
        lambda: OverrideStore(),
    )

    dispatcher = FakeDispatcher()
    result = asyncio.run(
        handle_webex_message(
            _event(text="howdy") | {"roomType": "direct"},
            identity_linker=FakeIdentityLinker(),
            team_resolver=FakeTeamResolver(),
            obo_exchanger=FakeOboExchanger(),
            # Direct messages use the personal-access check above, not a
            # shared-space assignment.
            rebac_checker=FakeRebacChecker(
                allowed=False,
                reason="missing_space_grant",
            ),
            dispatcher=dispatcher,
        )
    )

    assert result.allowed is True
    assert result.agent_id == "personal-webex-agent"
    assert dispatcher.calls[0]["agent_id"] == "personal-webex-agent"
