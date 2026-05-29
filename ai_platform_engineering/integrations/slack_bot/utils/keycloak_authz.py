"""Keycloak Authorization Services client for Slack bot RBAC (PDP-1).

Uses UMA ticket grant with response_mode=decision to evaluate permissions
against the 098 permission matrix modeled in Keycloak.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import httpx


@dataclass(frozen=True)
class RbacCheckRequest:
    resource: str
    scope: str
    access_token: str


@dataclass(frozen=True)
class RbacCheckResult:
    allowed: bool
    reason: Optional[str] = None


@dataclass(frozen=True)
class KeycloakAuthzConfig:
    server_url: str = os.environ.get("KEYCLOAK_URL", "http://localhost:7080")
    realm: str = os.environ.get("KEYCLOAK_REALM", "caipe")
    client_id: str = os.environ.get("KEYCLOAK_RESOURCE_SERVER_ID", "caipe-platform")
    client_secret: Optional[str] = os.environ.get("KEYCLOAK_CLIENT_SECRET")


_default_config = KeycloakAuthzConfig()


def _token_endpoint(config: KeycloakAuthzConfig) -> str:
    return f"{config.server_url}/realms/{config.realm}/protocol/openid-connect/token"


async def check_permission(
    request: RbacCheckRequest,
    config: KeycloakAuthzConfig | None = None,
) -> RbacCheckResult:
    """Check a single permission against Keycloak Authorization Services.

    Uses UMA ticket grant with response_mode=decision for a boolean result.
    """
    cfg = config or _default_config
    endpoint = _token_endpoint(cfg)
    permission = f"{request.resource}#{request.scope}"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                endpoint,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:uma-ticket",
                    "audience": cfg.client_id,
                    "permission": permission,
                    "response_mode": "decision",
                },
                headers={"Authorization": f"Bearer {request.access_token}"},
            )

        if resp.status_code == 200:
            data = resp.json()
            return RbacCheckResult(allowed=data.get("result", False) is True)

        if resp.status_code == 403:
            return RbacCheckResult(allowed=False, reason="DENY_NO_CAPABILITY")

        return RbacCheckResult(
            allowed=False, reason=f"PDP error: {resp.status_code}"
        )
    except (httpx.HTTPError, httpx.TimeoutException):
        return RbacCheckResult(allowed=False, reason="DENY_PDP_UNAVAILABLE")


async def check_permissions(
    requests: list[RbacCheckRequest],
    config: KeycloakAuthzConfig | None = None,
) -> dict[str, RbacCheckResult]:
    """Check multiple permissions concurrently."""
    import asyncio

    cfg = config or _default_config
    results: dict[str, RbacCheckResult] = {}

    async def _check(req: RbacCheckRequest) -> None:
        key = f"{req.resource}#{req.scope}"
        results[key] = await check_permission(req, cfg)

    await asyncio.gather(*[_check(r) for r in requests])
    return results


async def get_effective_permissions(
    access_token: str,
    config: KeycloakAuthzConfig | None = None,
) -> dict[str, list[str]]:
    """Get all effective permissions for a user.

    Requests an RPT with response_mode=permissions to get all granted permissions.
    """
    cfg = config or _default_config
    endpoint = _token_endpoint(cfg)

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                endpoint,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:uma-ticket",
                    "audience": cfg.client_id,
                    "response_mode": "permissions",
                },
                headers={"Authorization": f"Bearer {access_token}"},
            )

        if resp.status_code != 200:
            return {}

        permissions: list[dict] = resp.json()
        return {p["rsname"]: p.get("scopes", []) for p in permissions}
    except (httpx.HTTPError, httpx.TimeoutException):
        return {}
