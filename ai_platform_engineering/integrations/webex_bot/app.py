"""Webex bot runtime gate — identity, OBO, team mapping, ReBAC, route, dispatch."""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional, Protocol

from .utils.audit import log_webex_authz_decision
from .utils.identity_linker import WebexIdentityLinker
from .utils.obo_exchange import OboExchangeError, OboToken, impersonate_user
from .utils.space_team_resolver import SpaceTeamResolution, WebexSpaceTeamResolver
from .utils.user_messages import TEAM_SESSION_UNAVAILABLE_MESSAGE
from .utils.webex_ids import (
    canonicalize_webex_space_id,
    is_valid_webex_person_id,
    is_valid_webex_space_id,
    public_webex_room_id_from_uuid,
)
from .utils.webex_rebac import WebexRebacEvaluator, WebexSpaceRebacDecision

logger = logging.getLogger("caipe.webex_bot")

REASON_IGNORED_BOT = "WEBEX_IGNORED_BOT"
REASON_IGNORED_SELF = "WEBEX_IGNORED_SELF"
REASON_IGNORED_MALFORMED = "WEBEX_IGNORED_MALFORMED"
REASON_USER_NOT_LINKED = "WEBEX_USER_NOT_LINKED"
REASON_IDENTITY_UNAVAILABLE = "WEBEX_IDENTITY_UNAVAILABLE"
REASON_WORKSPACE_UNCONFIGURED = "WEBEX_WORKSPACE_UNCONFIGURED"
REASON_SPACE_TEAM_NOT_FOUND = "WEBEX_SPACE_TEAM_NOT_FOUND"
REASON_OBO_FAILED = "WEBEX_OBO_FAILED"
REASON_DISPATCH_ALLOWED = "WEBEX_DISPATCH_ALLOWED"


@dataclass(frozen=True)
class ParsedWebexEvent:
    person_id: str
    space_id: str
    workspace_id: str
    text: str
    is_bot: bool
    is_self: bool
    message_id: Optional[str] = None
    thread_parent_id: Optional[str] = None
    webex_room_id: Optional[str] = None


@dataclass(frozen=True)
class WebexRouteResolution:
    agent_id: Optional[str]
    deny_message: Optional[str] = None


@dataclass(frozen=True)
class WebexMessageResult:
    allowed: bool
    dispatched: bool
    ignored: bool
    reason_code: str
    linking_url: Optional[str] = None
    deny_message: Optional[str] = None
    rebac_reason: Optional[str] = None
    active_team: Optional[str] = None
    agent_id: Optional[str] = None
    keycloak_user_id: Optional[str] = None


class IdentityLinkerProtocol(Protocol):
    async def resolve(self, webex_user_id: str) -> Optional[str]: ...

    async def linking_url(self, webex_user_id: str) -> Optional[str]: ...


class TeamResolverProtocol(Protocol):
    async def resolve(self, space_id: str, keycloak_user_id: str) -> SpaceTeamResolution: ...


class OboExchangerProtocol(Protocol):
    async def impersonate(
        self, keycloak_user_id: str, *, active_team: str
    ) -> OboToken: ...


class RebacCheckerProtocol(Protocol):
    def check_agent_access(
        self,
        *,
        workspace_id: str,
        space_id: str,
        agent_id: str,
        active_team: Optional[str],
        obo_token: str,
    ) -> WebexSpaceRebacDecision: ...


class RouteResolverProtocol(Protocol):
    async def resolve_route(
        self,
        *,
        workspace_id: str,
        space_id: str,
        person_id: str,
        text: str,
    ) -> WebexRouteResolution: ...


DispatchFn = Callable[[dict[str, Any]], Awaitable[None]]


def configured_webex_workspace_ref() -> Optional[str]:
    """Deployment-configured Webex workspace namespace (never from webhook payloads)."""
    alias = os.environ.get("WEBEX_WORKSPACE_ALIAS", "").strip()
    if alias:
        return alias
    workspace_id = os.environ.get("WEBEX_WORKSPACE_ID", "").strip()
    if workspace_id:
        return workspace_id
    return None


def webex_workspace_ref() -> str:
    """Configured workspace ref or empty string when unset (callers should deny)."""
    return configured_webex_workspace_ref() or ""


def parse_event_flag(*values: object) -> bool:
    """Parse Webex boolean flags without treating string ``\"false\"`` as truthy."""
    for value in values:
        if value is None:
            continue
        if isinstance(value, bool):
            if value:
                return True
            continue
        if isinstance(value, (int, float)):
            if value != 0:
                return True
            continue
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in ("true", "1", "yes", "on"):
                return True
            if normalized in ("false", "0", "no", "off", ""):
                continue
    return False


def parse_webex_event(event: dict[str, Any]) -> Optional[ParsedWebexEvent]:
    """Normalize a Webex webhook or test event into gate inputs."""
    data = event.get("data") if isinstance(event.get("data"), dict) else event

    person_id = (
        data.get("personId")
        or data.get("person_id")
        or event.get("personId")
        or event.get("person_id")
    )
    raw_space_id = (
        data.get("roomId")
        or data.get("space_id")
        or data.get("spaceId")
        or event.get("roomId")
        or event.get("space_id")
    )
    message_id = (
        data.get("id")
        or data.get("messageId")
        or data.get("message_id")
        or event.get("messageId")
        or event.get("message_id")
    )
    thread_parent_id = (
        data.get("parentId")
        or data.get("parent_id")
        or data.get("threadParentId")
        or data.get("thread_parent_id")
        or event.get("parentId")
        or event.get("parent_id")
        or event.get("threadParentId")
        or event.get("thread_parent_id")
    )
    webex_room_id = (
        data.get("webexRoomId")
        or data.get("publicRoomId")
        or event.get("webexRoomId")
        or event.get("publicRoomId")
    )
    text = str(data.get("text") or event.get("text") or "").strip()
    is_bot = parse_event_flag(
        data.get("isBot"),
        data.get("is_bot"),
        event.get("isBot"),
        event.get("is_bot"),
        data.get("personIsBot"),
        event.get("personIsBot"),
    )
    is_self = parse_event_flag(
        data.get("is_self"),
        data.get("isSelf"),
        event.get("is_self"),
        event.get("isSelf"),
    )

    if not isinstance(person_id, str) or not person_id.strip():
        return None
    if not isinstance(raw_space_id, str) or not raw_space_id.strip():
        return None
    space_id = canonicalize_webex_space_id(raw_space_id)
    if not is_valid_webex_person_id(person_id):
        return None
    if not is_valid_webex_space_id(space_id):
        return None

    workspace_id = webex_workspace_ref()
    public_room_id = str(webex_room_id).strip() if isinstance(webex_room_id, str) else None
    if not public_room_id:
        public_room_id = public_webex_room_id_from_uuid(space_id)

    return ParsedWebexEvent(
        person_id=person_id.strip(),
        space_id=space_id.strip(),
        workspace_id=workspace_id,
        text=text,
        is_bot=is_bot,
        is_self=is_self,
        message_id=str(message_id).strip() if isinstance(message_id, str) else None,
        thread_parent_id=(
            str(thread_parent_id).strip() if isinstance(thread_parent_id, str) else None
        ),
        webex_room_id=public_room_id,
    )


def _deny(
    reason_code: str,
    *,
    deny_message: Optional[str] = None,
    linking_url: Optional[str] = None,
    rebac_reason: Optional[str] = None,
    keycloak_user_id: Optional[str] = None,
    active_team: Optional[str] = None,
) -> WebexMessageResult:
    return WebexMessageResult(
        allowed=False,
        dispatched=False,
        ignored=False,
        reason_code=reason_code,
        deny_message=deny_message,
        linking_url=linking_url,
        rebac_reason=rebac_reason,
        keycloak_user_id=keycloak_user_id,
        active_team=active_team,
    )


def _ignore(reason_code: str) -> WebexMessageResult:
    return WebexMessageResult(
        allowed=False,
        dispatched=False,
        ignored=True,
        reason_code=reason_code,
    )


class _DefaultOboExchanger:
    async def impersonate(self, keycloak_user_id: str, *, active_team: str) -> OboToken:
        return await impersonate_user(keycloak_user_id, active_team=active_team)


class _WebexAgentRouteResolver:
    """Resolve routes via OpenFGA + Mongo when DB modes are enabled."""

    async def resolve_route(
        self,
        *,
        workspace_id: str,
        space_id: str,
        person_id: str,
        text: str,
    ) -> WebexRouteResolution:
        from .utils.webex_agent_routes import resolve_webex_agent_route

        agent_id, deny_message = await resolve_webex_agent_route(
            workspace_id=workspace_id,
            space_id=space_id,
            person_id=person_id,
            text=text,
        )
        return WebexRouteResolution(agent_id=agent_id, deny_message=deny_message)


async def handle_webex_message(
    event: dict[str, Any],
    *,
    identity_linker: IdentityLinkerProtocol | None = None,
    team_resolver: TeamResolverProtocol | None = None,
    obo_exchanger: OboExchangerProtocol | None = None,
    rebac_checker: RebacCheckerProtocol | None = None,
    route_resolver: RouteResolverProtocol | None = None,
    dispatcher: Optional[DispatchFn] = None,
    bot_person_id: Optional[str] = None,
    tenant_id: str = "default",
) -> WebexMessageResult:
    """Run the Webex RBAC runtime gate before agent dispatch.

    Gate order: parse → ignore bot/self/malformed → identity link → space team
    → OBO → route → ReBAC → dispatch. Route resolution runs before ReBAC because
    it supplies the ``agent_id`` checked by the access-check endpoint.
    """
    linker = identity_linker or WebexIdentityLinker()
    resolver = team_resolver or WebexSpaceTeamResolver()
    obo = obo_exchanger or _DefaultOboExchanger()
    rebac = rebac_checker or WebexRebacEvaluator()
    routes = route_resolver or _WebexAgentRouteResolver()

    parsed = parse_webex_event(event)
    if parsed is None:
        log_webex_authz_decision(
            tenant_id=tenant_id,
            sub="unknown",
            outcome="deny",
            reason_code="WEBEX_IGNORED_MALFORMED",
        )
        return _ignore(REASON_IGNORED_MALFORMED)

    if not parsed.workspace_id:
        log_webex_authz_decision(
            tenant_id=tenant_id,
            sub=parsed.person_id,
            outcome="deny",
            reason_code="WEBEX_WORKSPACE_UNCONFIGURED",
            webex_person_id=parsed.person_id,
            webex_space_id=parsed.space_id,
        )
        return _deny(
            REASON_WORKSPACE_UNCONFIGURED,
            deny_message=(
                "Webex workspace policy namespace is not configured. "
                "Set WEBEX_WORKSPACE_ALIAS or WEBEX_WORKSPACE_ID."
            ),
        )

    if parsed.is_bot:
        log_webex_authz_decision(
            tenant_id=tenant_id,
            sub=parsed.person_id,
            outcome="deny",
            reason_code="WEBEX_IGNORED_BOT",
            webex_person_id=parsed.person_id,
            webex_space_id=parsed.space_id,
        )
        return _ignore(REASON_IGNORED_BOT)

    if parsed.is_self or (bot_person_id and parsed.person_id == bot_person_id):
        log_webex_authz_decision(
            tenant_id=tenant_id,
            sub=parsed.person_id,
            outcome="deny",
            reason_code="WEBEX_IGNORED_SELF",
            webex_person_id=parsed.person_id,
            webex_space_id=parsed.space_id,
        )
        return _ignore(REASON_IGNORED_SELF)

    try:
        keycloak_user_id = await linker.resolve(parsed.person_id)
    except Exception as exc:  # noqa: BLE001 — fail closed on KC/network errors
        logger.error(
            "Webex identity resolution failed (type=%s); denying request",
            type(exc).__name__,
        )
        log_webex_authz_decision(
            tenant_id=tenant_id,
            sub=parsed.person_id,
            outcome="deny",
            reason_code="WEBEX_IDENTITY_UNAVAILABLE",
            pdp="keycloak",
            webex_person_id=parsed.person_id,
            webex_space_id=parsed.space_id,
        )
        return _deny(
            REASON_IDENTITY_UNAVAILABLE,
            deny_message=(
                "Identity verification is temporarily unavailable. Please try again later."
            ),
        )

    if keycloak_user_id is None:
        linking_url: Optional[str] = None
        try:
            linking_url = await linker.linking_url(parsed.person_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Webex linking URL mint failed (type=%s); continuing without URL",
                type(exc).__name__,
            )
        log_webex_authz_decision(
            tenant_id=tenant_id,
            sub=parsed.person_id,
            outcome="deny",
            reason_code="WEBEX_USER_NOT_LINKED",
            pdp="keycloak",
            webex_person_id=parsed.person_id,
            webex_space_id=parsed.space_id,
        )
        return _deny(
            REASON_USER_NOT_LINKED,
            deny_message=(
                "Your Webex account is not linked to an enterprise identity. "
                "Complete account linking before using this bot."
            ),
            linking_url=linking_url,
        )

    team_resolution = await resolver.resolve(parsed.space_id, keycloak_user_id)
    if not team_resolution.team_slug:
        from .utils.webex_agent_routes import get_webex_agent_route_resolver
        from .utils.webex_space_auto_assign import get_webex_space_auto_assigner

        auto_assign = await asyncio.to_thread(
            get_webex_space_auto_assigner().assign_space,
            workspace_id=parsed.workspace_id,
            space_id=parsed.space_id,
        )
        if auto_assign.assigned:
            get_webex_agent_route_resolver().invalidate(parsed.workspace_id, parsed.space_id)
            team_resolution = await resolver.resolve(parsed.space_id, keycloak_user_id)
        elif auto_assign.reason not in {"disabled", "existing_mapping"}:
            logger.warning(
                "Webex space auto-assignment skipped space=%s reason=%s",
                parsed.space_id,
                auto_assign.reason,
            )

    if not team_resolution.team_slug:
        log_webex_authz_decision(
            tenant_id=tenant_id,
            sub=keycloak_user_id,
            outcome="deny",
            reason_code="WEBEX_SPACE_TEAM_NOT_FOUND",
            webex_person_id=parsed.person_id,
            webex_space_id=parsed.space_id,
        )
        return _deny(
            REASON_SPACE_TEAM_NOT_FOUND,
            deny_message=team_resolution.deny_message,
            keycloak_user_id=keycloak_user_id,
        )

    active_team = team_resolution.team_slug

    try:
        obo_token = await obo.impersonate(keycloak_user_id, active_team=active_team)
    except (OboExchangeError, ValueError) as exc:
        logger.error(
            "Webex OBO impersonation failed for user=%s active_team=%s (type=%s)",
            keycloak_user_id,
            active_team,
            type(exc).__name__,
        )
        log_webex_authz_decision(
            tenant_id=tenant_id,
            sub=keycloak_user_id,
            outcome="deny",
            reason_code="WEBEX_OBO_FAILED",
            pdp="keycloak",
            webex_person_id=parsed.person_id,
            webex_space_id=parsed.space_id,
        )
        return _deny(
            REASON_OBO_FAILED,
            deny_message=TEAM_SESSION_UNAVAILABLE_MESSAGE,
            keycloak_user_id=keycloak_user_id,
            active_team=active_team,
        )

    route = await routes.resolve_route(
        workspace_id=parsed.workspace_id,
        space_id=parsed.space_id,
        person_id=parsed.person_id,
        text=parsed.text,
    )
    agent_id = route.agent_id
    if not agent_id:
        log_webex_authz_decision(
            tenant_id=tenant_id,
            sub=keycloak_user_id,
            outcome="deny",
            reason_code="WEBEX_ROUTE_DENIED",
            webex_person_id=parsed.person_id,
            webex_space_id=parsed.space_id,
        )
        return _deny(
            "WEBEX_ROUTE_DENIED",
            deny_message=route.deny_message,
            keycloak_user_id=keycloak_user_id,
            active_team=active_team,
        )

    rebac_decision = rebac.check_agent_access(
        workspace_id=parsed.workspace_id,
        space_id=parsed.space_id,
        agent_id=agent_id,
        active_team=active_team,
        obo_token=obo_token.access_token,
    )
    if not rebac_decision.allowed:
        audit_reason = (
            "DENY_PDP_UNAVAILABLE"
            if rebac_decision.reason == "pdp_unavailable"
            else "WEBEX_REBAC_DENIED"
        )
        log_webex_authz_decision(
            tenant_id=tenant_id,
            sub=keycloak_user_id,
            outcome="deny",
            reason_code=audit_reason,
            webex_person_id=parsed.person_id,
            webex_space_id=parsed.space_id,
            resource_ref=f"agent:{agent_id}",
        )
        return _deny(
            rebac_decision.reason,
            deny_message=(
                "This Webex space is not authorized to use that CAIPE resource, "
                "or your team does not have access."
            ),
            rebac_reason=rebac_decision.reason,
            keycloak_user_id=keycloak_user_id,
            active_team=active_team,
        )

    if dispatcher is not None:
        await dispatcher(
            {
                "person_id": parsed.person_id,
                "space_id": parsed.space_id,
                "workspace_id": parsed.workspace_id,
                "text": parsed.text,
                "keycloak_user_id": keycloak_user_id,
                "active_team": active_team,
                "agent_id": agent_id,
                "obo_token": obo_token.access_token,
                "message_id": parsed.message_id,
                "thread_parent_id": parsed.thread_parent_id,
                "webex_room_id": parsed.webex_room_id,
            }
        )

    log_webex_authz_decision(
        tenant_id=tenant_id,
        sub=keycloak_user_id,
        outcome="allow",
        reason_code="WEBEX_DISPATCH_ALLOWED",
        webex_person_id=parsed.person_id,
        webex_space_id=parsed.space_id,
        resource_ref=f"agent:{agent_id}",
    )
    return WebexMessageResult(
        allowed=True,
        dispatched=dispatcher is not None,
        ignored=False,
        reason_code=REASON_DISPATCH_ALLOWED,
        keycloak_user_id=keycloak_user_id,
        active_team=active_team,
        agent_id=agent_id,
    )
