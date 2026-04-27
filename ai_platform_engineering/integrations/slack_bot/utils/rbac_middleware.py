"""RBAC enforcement middleware for the Slack bot (FR-008, FR-022).

Wraps Slack event/command handlers to call Keycloak AuthZ before processing.
Returns an ephemeral denial message on failure and logs audit events.
"""

from __future__ import annotations

import base64
import functools
import json
import logging
from typing import Any, Callable, Mapping, Optional, cast

from .audit import log_authz_decision
from .channel_team_mapper import user_has_team_member_role
from .keycloak_authz import RbacCheckRequest, check_permission

logger = logging.getLogger("caipe.slack_bot.rbac")

TEAM_ROLE_MISMATCH_MESSAGE = (
    "You don't have access to CAIPE in this channel. "
    "Ask your admin to add you to the team for this channel."
)

# Human-readable action labels for Slack ephemeral messages
_ACTION_LABELS: dict[str, str] = {
    "admin_ui#view": "view the admin dashboard",
    "admin_ui#configure": "change platform settings",
    "rag#tool.create": "create RAG tools",
    "rag#tool.update": "update RAG tools",
    "rag#tool.delete": "delete RAG tools",
    "rag#kb.admin": "administer knowledge bases",
    "rag#query": "query knowledge bases",
    "supervisor#invoke": "use the assistant",
    "tool#invoke": "invoke tools",
    "mcp#invoke": "invoke MCP tools",
    "skill#invoke": "execute skills",
    "a2a#create": "create agent tasks",
    "slack#invoke": "run this command",
}


def _human_action(resource: str, scope: str) -> str:
    return _ACTION_LABELS.get(f"{resource}#{scope}", f"access {resource} ({scope})")


def format_slack_denial(resource: str, scope: str) -> str:
    """Format a denied-action ephemeral message for Slack (FR-004)."""
    action = _human_action(resource, scope)
    return (
        f"Sorry, you don't have permission to {action}. "
        "Ask your workspace admin for access."
    )


def _decode_jwt_payload_unverified(token: str) -> dict[str, Any]:
    """Parse JWT payload JSON without verifying the signature.

    Used only to read the ``org`` claim for tenant scoping; the token is
    already an OBO/access token obtained from Keycloak.
    """
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    payload_b64 = parts[1]
    pad = 4 - len(payload_b64) % 4
    if pad != 4:
        payload_b64 += "=" * pad
    try:
        raw = base64.urlsafe_b64decode(payload_b64.encode("ascii"))
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _realm_roles_from_access_token_unverified(token: str) -> list[str]:
    payload = _decode_jwt_payload_unverified(token)
    ra = payload.get("realm_access")
    if isinstance(ra, dict):
        roles = ra.get("roles")
        if isinstance(roles, list):
            return [str(r) for r in roles]
    roles = payload.get("roles")
    if isinstance(roles, list):
        return [str(r) for r in roles]
    return []


def extract_tenant_from_context(kwargs: Mapping[str, Any]) -> Optional[str]:
    """Return tenant id from ``org`` claim on the OBO/user JWT.

    Prefers ``obo_token`` on the Bolt ``context``, then ``access_token``
    / ``obo_token`` kwargs (same token used for Keycloak AuthZ).
    """
    ctx = kwargs.get("context")
    token: Optional[str] = None
    if ctx is not None and hasattr(ctx, "get"):
        token = cast(Optional[str], ctx.get("obo_token") or ctx.get("access_token"))
    token = token or kwargs.get("obo_token") or kwargs.get("access_token")
    if not token or not isinstance(token, str):
        return None
    org = _decode_jwt_payload_unverified(token).get("org")
    return org if isinstance(org, str) and org else None


def require_permission(
    resource: str,
    scope: str,
    *,
    tenant_id: str = "default",
) -> Callable:
    """Decorator: enforce RBAC before a Slack handler executes.

    The decorated function must accept ``access_token`` as a keyword argument
    (injected by the identity-linking layer after OBO exchange).
    If the check fails, the decorator sends an ephemeral denial and skips the handler.
    """

    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            access_token: Optional[str] = kwargs.get("access_token")
            sub: str = kwargs.get("user_sub", "unknown")

            if not access_token:
                log_authz_decision(
                    tenant_id=tenant_id,
                    sub=sub,
                    resource=resource,  # type: ignore[arg-type]
                    scope=scope,
                    outcome="deny",
                    reason_code="DENY_UNLINKED",
                    pdp="keycloak",
                )
                return format_slack_denial(resource, scope)

            bolt_ctx = kwargs.get("context")
            if isinstance(bolt_ctx, dict) and bolt_ctx.get("rbac_enabled"):
                tid = bolt_ctx.get("platform_team_id")
                if isinstance(tid, str) and tid:
                    jwt_roles = _realm_roles_from_access_token_unverified(access_token)
                    if not user_has_team_member_role(jwt_roles, tid):
                        log_authz_decision(
                            tenant_id=tenant_id,
                            sub=sub,
                            resource=resource,  # type: ignore[arg-type]
                            scope=scope,
                            outcome="deny",
                            reason_code="DENY_TEAM_SCOPE",
                            pdp="keycloak",
                        )
                        return TEAM_ROLE_MISMATCH_MESSAGE

            merged_kwargs = {**kwargs, "access_token": access_token}
            jwt_tenant = extract_tenant_from_context(merged_kwargs)
            if jwt_tenant is not None and bolt_ctx is not None:
                try:
                    bolt_ctx["tenant_id"] = jwt_tenant
                except TypeError:
                    pass

            if isinstance(bolt_ctx, dict) and bolt_ctx.get("rbac_enabled"):
                tid_ctx = bolt_ctx.get("platform_team_id")
                if isinstance(tid_ctx, str) and tid_ctx:
                    try:
                        bolt_ctx["resolved_team_id"] = tid_ctx
                    except TypeError:
                        pass

            audit_tenant = jwt_tenant or tenant_id

            result = await check_permission(
                RbacCheckRequest(
                    resource=resource,
                    scope=scope,
                    access_token=access_token,
                )
            )

            log_authz_decision(
                tenant_id=audit_tenant,
                sub=sub,
                resource=resource,  # type: ignore[arg-type]
                scope=scope,
                outcome="allow" if result.allowed else "deny",
                reason_code="OK" if result.allowed else (result.reason or "DENY_NO_CAPABILITY"),  # type: ignore[arg-type]
                pdp="keycloak",
            )

            if not result.allowed:
                return format_slack_denial(resource, scope)

            return await fn(*args, **kwargs)

        return wrapper

    return decorator
