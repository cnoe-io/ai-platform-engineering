#!/usr/bin/env python3
"""Delete deprecated CAIPE Keycloak realm roles from a local realm.

Keycloak is now identity-only for CAIPE authorization. Run this against local
dev realms after loading the new bootstrap config so stale realm roles no
longer appear in tokens or the admin console.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


LEGACY_ROLE_NAMES = {
    "admin",
    "admin_user",
    "chat_user",
    "team_member",
    "kb_admin",
}
LEGACY_ROLE_PREFIXES = (
    "team_member:",
    "kb_reader:",
    "kb_ingestor:",
    "kb_admin:",
    "agent_user:",
    "agent_admin:",
    "tool_user:",
)
KEEP_ROLE_NAMES = {"default-roles-caipe", "offline_access", "uma_authorization"}


@dataclass(frozen=True)
class Config:
    base_url: str
    realm: str
    admin_user: str
    admin_password: str
    dry_run: bool


def env_config() -> Config:
    missing = [
        name
        for name in ("KEYCLOAK_ADMIN", "KEYCLOAK_ADMIN_PASSWORD")
        if not os.environ.get(name)
    ]
    if missing:
        raise SystemExit(f"Missing required env var(s): {', '.join(missing)}")
    return Config(
        base_url=os.environ.get("KC_URL", "http://localhost:7080").rstrip("/"),
        realm=os.environ.get("KC_REALM", "caipe"),
        admin_user=os.environ["KEYCLOAK_ADMIN"],
        admin_password=os.environ["KEYCLOAK_ADMIN_PASSWORD"],
        dry_run=os.environ.get("DRY_RUN", "true").lower() != "false",
    )


def request_json(method: str, url: str, *, token: str | None = None, data: object | None = None):
    body = None if data is None else json.dumps(data).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as response:
        raw = response.read()
        if not raw:
            return None
        return json.loads(raw)


def request_form(url: str, form: dict[str, str]):
    req = urllib.request.Request(
        url,
        data=urllib.parse.urlencode(form).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.loads(response.read())


def admin_token(config: Config) -> str:
    payload = request_form(
        f"{config.base_url}/realms/master/protocol/openid-connect/token",
        {
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": config.admin_user,
            "password": config.admin_password,
        },
    )
    token = payload.get("access_token")
    if not token:
        raise SystemExit("Keycloak did not return an admin access token")
    return str(token)


def is_legacy_role(name: str) -> bool:
    return name in LEGACY_ROLE_NAMES or any(name.startswith(prefix) for prefix in LEGACY_ROLE_PREFIXES)


def delete_role(config: Config, token: str, name: str) -> None:
    encoded = urllib.parse.quote(name, safe="")
    url = f"{config.base_url}/admin/realms/{config.realm}/roles/{encoded}"
    req = urllib.request.Request(url, method="DELETE", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=15):
            print(f"deleted role {name}")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            print(f"role {name} already absent")
            return
        raise


def main() -> int:
    config = env_config()
    token = admin_token(config)
    roles = request_json(
        "GET",
        f"{config.base_url}/admin/realms/{config.realm}/roles",
        token=token,
    )
    if not isinstance(roles, list):
        raise SystemExit("Unexpected Keycloak roles response")

    legacy = sorted(
        role["name"]
        for role in roles
        if isinstance(role, dict)
        and isinstance(role.get("name"), str)
        and role["name"] not in KEEP_ROLE_NAMES
        and is_legacy_role(role["name"])
    )
    if not legacy:
        print("No legacy CAIPE realm roles found.")
        return 0
    print("Legacy CAIPE realm roles:")
    for name in legacy:
        print(f"  - {name}")
    if config.dry_run:
        print("DRY_RUN=true; set DRY_RUN=false to delete.")
        return 0
    for name in legacy:
        delete_role(config, token, name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
