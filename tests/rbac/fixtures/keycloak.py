"""Persona token fixture (Python side) — spec 102 `data-model.md` §E5.

Mints real Keycloak access tokens for the six personas defined in spec.md §Personas
(`alice_admin`, `bob_chat_user`, `carol_kb_ingestor`, `dave_no_role`,
`eve_dynamic_agent_user`, `frank_service_account`).

Why a real Keycloak (not a mock)?
  Per the 2026-04-22 clarification (`real_kc` for the e2e fixture), every gate
  exercised by Jest+pytest+Playwright runs against a live Keycloak so we
  exercise the same JWT signing keys, claim shape, and PDP that production
  uses. The compose stack at `docker-compose.dev.yaml` provides one (the e2e
  lane reuses the same compose file via curated `COMPOSE_PROFILES` and a
  handful of env-var substitutions — see Makefile `test-rbac-up`).

Resource Owner Password Credentials grant is intentionally enabled ONLY on the
test client `caipe-platform` (already `directAccessGrantsEnabled: true` in
`deploy/keycloak/realm-config.json`). Production clients never set this.

This module is **import-time pure**. The first call to `get_persona_token`
does the network round-trip; subsequent calls within `_REFRESH_SLACK_S` of
expiry use the cached token. Tests can call `clear_persona_cache()` between
sessions if they need a fresh token (e.g. after rotating roles in init-idp.sh).
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Literal

import httpx

PersonaName = Literal[
    "alice_admin",
    "bob_chat_user",
    "carol_kb_ingestor",
    "dave_no_role",
    "eve_dynamic_agent_user",
    "frank_service_account",
]

PERSONAS: tuple[PersonaName, ...] = (
    "alice_admin",
    "bob_chat_user",
    "carol_kb_ingestor",
    "dave_no_role",
    "eve_dynamic_agent_user",
    "frank_service_account",
)

# Default per-persona credential matrix. Tests may override via env vars
# (e.g. ALICE_ADMIN_PASSWORD) but the defaults match `init-idp.sh` (T019).
_DEFAULT_PASSWORD = "test-password-123"  # noqa: S105 — test-only, never used in prod

# 30s safety margin before expiry to refresh — `data-model.md` §E5.
_REFRESH_SLACK_S = 30


@dataclass(frozen=True)
class PersonaToken:
    """Result of minting a persona token.

    Attributes:
        access_token: Raw JWT to place in `Authorization: Bearer <…>`.
        refresh_token: Refresh token (used internally; tests rarely need it).
        decoded_claims: Decoded JWT payload (best-effort; we never validate the
            signature here — this is a TEST fixture, not a production verifier).
        expires_at: Unix epoch seconds when the access token expires.
    """

    access_token: str
    refresh_token: str
    decoded_claims: dict[str, Any]
    expires_at: float


# Module-level cache — `data-model.md` §E5 mandates per-session caching.
_CACHE: dict[PersonaName, PersonaToken] = {}
_CACHE_LOCK = threading.Lock()


def _kc_base_url() -> str:
    return os.environ.get("KEYCLOAK_URL", "http://localhost:7080").rstrip("/")


def _kc_realm() -> str:
    return os.environ.get("KEYCLOAK_REALM", "caipe")


def _kc_client_id() -> str:
    return os.environ.get("KEYCLOAK_TEST_CLIENT_ID", "caipe-platform")


def _kc_client_secret() -> str:
    return os.environ.get("KEYCLOAK_TEST_CLIENT_SECRET", "caipe-platform-dev-secret")


def _persona_password(name: PersonaName) -> str:
    env_var = f"{name.upper()}_PASSWORD"
    return os.environ.get(env_var, _DEFAULT_PASSWORD)


def _decode_payload_unsafe(token: str) -> dict[str, Any]:
    """Decode the JWT payload WITHOUT verifying the signature.

    Test fixture only. We never use this output for authorization. The Python
    helpers in `ai_platform_engineering/utils/auth/keycloak_authz.py` perform
    the real validation against Keycloak.
    """
    import base64
    import json

    parts = token.split(".")
    if len(parts) != 3:
        return {}
    payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload_b64))
    except Exception:
        return {}


def _mint_password_grant(name: PersonaName) -> PersonaToken:
    """POST to `/realms/<realm>/protocol/openid-connect/token` with password grant."""
    url = f"{_kc_base_url()}/realms/{_kc_realm()}/protocol/openid-connect/token"
    data = {
        "grant_type": "password",
        "client_id": _kc_client_id(),
        "client_secret": _kc_client_secret(),
        "username": name,
        "password": _persona_password(name),
        "scope": "openid profile email",
    }
    with httpx.Client(timeout=10.0) as client:
        resp = client.post(url, data=data)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Keycloak token mint for persona {name!r} failed: "
            f"HTTP {resp.status_code} — {resp.text[:500]}"
        )
    body = resp.json()
    expires_in = float(body.get("expires_in", 60))
    return PersonaToken(
        access_token=body["access_token"],
        refresh_token=body.get("refresh_token", ""),
        decoded_claims=_decode_payload_unsafe(body["access_token"]),
        expires_at=time.time() + expires_in,
    )


def _mint_client_credentials() -> PersonaToken:
    """For `frank_service_account` — `grant_type=client_credentials` against the test client.

    Service-account tokens have no refresh token; we still cache by expiry.
    """
    url = f"{_kc_base_url()}/realms/{_kc_realm()}/protocol/openid-connect/token"
    data = {
        "grant_type": "client_credentials",
        "client_id": _kc_client_id(),
        "client_secret": _kc_client_secret(),
    }
    with httpx.Client(timeout=10.0) as client:
        resp = client.post(url, data=data)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Keycloak client_credentials mint failed: HTTP {resp.status_code} — {resp.text[:500]}"
        )
    body = resp.json()
    expires_in = float(body.get("expires_in", 60))
    return PersonaToken(
        access_token=body["access_token"],
        refresh_token=body.get("refresh_token", ""),
        decoded_claims=_decode_payload_unsafe(body["access_token"]),
        expires_at=time.time() + expires_in,
    )


def get_persona_token(name: PersonaName) -> PersonaToken:
    """Return a (cached) `PersonaToken` for the named persona.

    Caches per-process. Refreshes within `_REFRESH_SLACK_S` of expiry.
    """
    if name not in PERSONAS:
        raise ValueError(f"Unknown persona {name!r}; expected one of {PERSONAS}")

    with _CACHE_LOCK:
        cached = _CACHE.get(name)
        if cached is not None and cached.expires_at - time.time() > _REFRESH_SLACK_S:
            return cached

        token = (
            _mint_client_credentials()
            if name == "frank_service_account"
            else _mint_password_grant(name)
        )
        _CACHE[name] = token
        return token


def clear_persona_cache() -> None:
    """Drop all cached tokens. Tests call this when they need to force a re-mint."""
    with _CACHE_LOCK:
        _CACHE.clear()


__all__ = [
    "PERSONAS",
    "PersonaName",
    "PersonaToken",
    "clear_persona_cache",
    "get_persona_token",
]
