"""Keycloak Admin API client for user attribute operations (FR-025).

Supports looking up users by attribute (e.g. slack_user_id) and
setting/reading user attributes. Used by the identity linking flow
to associate Slack users with Keycloak identities.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

logger = logging.getLogger("caipe.slack_bot.keycloak_admin")


@dataclass(frozen=True)
class KeycloakAdminConfig:
    server_url: str = field(
        default_factory=lambda: os.environ.get("KEYCLOAK_URL", "http://localhost:7080")
    )
    realm: str = field(
        default_factory=lambda: os.environ.get("KEYCLOAK_REALM", "caipe")
    )
    client_id: str = field(
        default_factory=lambda: os.environ.get("KEYCLOAK_ADMIN_CLIENT_ID", "caipe-slack-bot")
    )
    client_secret: Optional[str] = field(
        default_factory=lambda: os.environ.get("KEYCLOAK_ADMIN_CLIENT_SECRET")
    )


_default_config = KeycloakAdminConfig()


async def _get_admin_token(config: KeycloakAdminConfig) -> str:
    """Obtain a service-account access token via client_credentials grant."""
    endpoint = f"{config.server_url}/realms/{config.realm}/protocol/openid-connect/token"

    async with httpx.AsyncClient(timeout=10.0) as client:
        data: dict[str, str] = {
            "grant_type": "client_credentials",
            "client_id": config.client_id,
        }
        if config.client_secret:
            data["client_secret"] = config.client_secret

        resp = await client.post(endpoint, data=data)
        resp.raise_for_status()
        return resp.json()["access_token"]


async def get_user_by_attribute(
    attr: str,
    value: str,
    config: KeycloakAdminConfig | None = None,
) -> Optional[dict[str, Any]]:
    """Find a Keycloak user whose attribute *attr* equals *value*.

    Returns the first matching user dict, or ``None`` if no match.
    Uses the Keycloak Admin REST API ``GET /admin/realms/{realm}/users?q=attr:value``.
    """
    cfg = config or _default_config
    token = await _get_admin_token(cfg)
    url = f"{cfg.server_url}/admin/realms/{cfg.realm}/users"

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            url,
            params={"q": f"{attr}:{value}", "max": 1},
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        users = resp.json()
        return users[0] if users else None


async def set_user_attribute(
    user_id: str,
    attr: str,
    value: str,
    config: KeycloakAdminConfig | None = None,
) -> None:
    """Set or overwrite a single user attribute on a Keycloak user.

    Reads the current attributes to avoid clobbering unrelated ones,
    then PUTs the updated representation.
    """
    cfg = config or _default_config
    token = await _get_admin_token(cfg)
    url = f"{cfg.server_url}/admin/realms/{cfg.realm}/users/{user_id}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        get_resp = await client.get(
            url, headers={"Authorization": f"Bearer {token}"}
        )
        get_resp.raise_for_status()
        user_repr = get_resp.json()

        attributes: dict[str, list[str]] = user_repr.get("attributes", {})
        attributes[attr] = [value]

        put_resp = await client.put(
            url,
            json={"attributes": attributes},
            headers={"Authorization": f"Bearer {token}"},
        )
        put_resp.raise_for_status()
        logger.info("Set attribute %s on user %s", attr, user_id)


async def get_user_attribute(
    user_id: str,
    attr: str,
    config: KeycloakAdminConfig | None = None,
) -> Optional[str]:
    """Read a single user attribute value. Returns ``None`` if absent."""
    cfg = config or _default_config
    token = await _get_admin_token(cfg)
    url = f"{cfg.server_url}/admin/realms/{cfg.realm}/users/{user_id}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            url, headers={"Authorization": f"Bearer {token}"}
        )
        resp.raise_for_status()
        user_repr = resp.json()
        vals = user_repr.get("attributes", {}).get(attr, [])
        return vals[0] if vals else None


async def remove_user_attribute(
    user_id: str,
    attr: str,
    config: KeycloakAdminConfig | None = None,
) -> None:
    """Remove a user attribute if present (other attributes preserved)."""
    cfg = config or _default_config
    token = await _get_admin_token(cfg)
    url = f"{cfg.server_url}/admin/realms/{cfg.realm}/users/{user_id}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        get_resp = await client.get(
            url, headers={"Authorization": f"Bearer {token}"}
        )
        get_resp.raise_for_status()
        user_repr = get_resp.json()
        attributes: dict[str, list[str]] = dict(user_repr.get("attributes", {}))
        attributes.pop(attr, None)

        put_resp = await client.put(
            url,
            json={"attributes": attributes},
            headers={"Authorization": f"Bearer {token}"},
        )
        put_resp.raise_for_status()
        logger.info("Removed attribute %s from user %s", attr, user_id)


async def get_user_by_email(
    email: str,
    config: KeycloakAdminConfig | None = None,
) -> Optional[dict[str, Any]]:
    """Find a Keycloak user by exact email match.

    Returns the first matching user dict, or ``None`` if not found.
    """
    cfg = config or _default_config
    token = await _get_admin_token(cfg)
    url = f"{cfg.server_url}/admin/realms/{cfg.realm}/users"

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            url,
            params={"email": email, "exact": "true", "max": 1},
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        users = resp.json()
        return users[0] if users else None


async def fetch_user_realm_role_names(
    user_id: str,
    config: KeycloakAdminConfig | None = None,
) -> list[str]:
    """Return realm role names assigned to the user (via Admin API)."""
    cfg = config or _default_config
    token = await _get_admin_token(cfg)
    url = f"{cfg.server_url}/admin/realms/{cfg.realm}/users/{user_id}/role-mappings/realm"

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
        resp.raise_for_status()
        raw = resp.json()
        if not isinstance(raw, list):
            return []
        return [str(r.get("name", "")) for r in raw if r.get("name")]
