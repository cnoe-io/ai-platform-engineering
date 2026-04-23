"""Keycloak Admin API client for user attribute operations (FR-025).

Supports looking up users by attribute (e.g. slack_user_id) and
setting/reading user attributes. Used by the identity linking flow
to associate Slack users with Keycloak identities.

Environment variables (slack-bot only — do NOT confuse with the UI's
``KEYCLOAK_ADMIN_*`` vars, which target the Next.js BFF Admin API path
and use a different client/grant flow):

* ``KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID``  — Keycloak client used by the
  slack-bot service account when calling the Admin REST API. Must be
  confidential (``publicClient=false``), have
  ``serviceAccountsEnabled=true`` and the ``realm-management`` roles
  ``view-users`` + ``query-users`` so the bot can look up users by
  ``slack_user_id`` attribute. Default ``caipe-platform`` (which the
  realm seeder grants those roles).
* ``KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET`` — Matching client_secret for
  the client above. If unset, the client_credentials grant is sent
  without a secret (only valid if the client is configured for none —
  almost never the case in practice).

Historical note (098): these used to be ``KEYCLOAK_ADMIN_CLIENT_ID/_SECRET``,
which collided with the same-named vars consumed by the UI BFF. The shared
namespace caused the slack-bot to inherit ``admin-cli`` from a UI-oriented
``.env`` setting, which is a public client and rejects ``client_credentials``
with ``HTTP 401 "Public client not allowed to retrieve service account"``.
The dedicated ``KEYCLOAK_SLACK_BOT_ADMIN_*`` names eliminate that collision
and leave room for future surfaces (e.g. ``KEYCLOAK_WEBEX_BOT_ADMIN_*``).
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

logger = logging.getLogger("caipe.slack_bot.keycloak_admin")


# --------------------------------------------------------------------------- #
# JIT (Just-in-Time) user creation                                            #
# --------------------------------------------------------------------------- #
#
# JIT is the path that creates a Keycloak shell user the first time a Slack
# user DMs the bot, when no Keycloak user with their email exists yet.
#
# Design choice (spec 103, FR-004 / FR-005): JIT reuses the *same*
# ``KEYCLOAK_SLACK_BOT_ADMIN_*`` credentials as the lookup paths above —
# i.e. it goes through the existing ``KeycloakAdminConfig``. We deliberately
# did NOT introduce a separate ``caipe-slack-bot-provisioner`` client. The
# trade-off (one secret can both read and create users) is documented in
# ``docs/docs/specs/103-slack-jit-user-creation/plan.md`` R-8 and accepted
# in exchange for operational simplicity (one Secret to manage, one rotation
# procedure, one audit identity).
#
# Compensating mitigations:
# 1. The ``create_user_from_slack`` helper below is the ONLY function that
#    POSTs to ``/users``; callers never get a generic "POST any user" surface.
# 2. Any follow-up ``PUT /users/{id}`` performed inside this helper targets
#    the just-returned UUID only — never an arbitrary id passed in.
# 3. The ``caipe-platform`` service account holds exactly
#    {view-users, query-users, manage-users} and no other realm-management
#    roles (asserted idempotently by ``init-idp.sh`` and pinned in
#    ``realm-config.json``).


class JitError(Exception):
    """Base class for JIT user creation failures.

    The ``error_kind`` attribute carries a stable identifier that the
    caller logs verbatim per spec FR-011 so SIEM rules can key off it.
    """

    error_kind: str = "unknown"


class JitAuthError(JitError):
    """Keycloak rejected the admin token (HTTP 401)."""

    error_kind = "auth_failure"


class JitForbiddenError(JitError):
    """Admin token was accepted but lacks ``manage-users`` (HTTP 403)."""

    error_kind = "forbidden"


class JitServerError(JitError):
    """Keycloak returned a 5xx — likely transient."""

    error_kind = "server_error"


class JitNetworkError(JitError):
    """Network/connection error reaching Keycloak."""

    error_kind = "network_error"


@dataclass(frozen=True)
class KeycloakAdminConfig:
    server_url: str = field(
        default_factory=lambda: os.environ.get("KEYCLOAK_URL", "http://localhost:7080")
    )
    realm: str = field(
        default_factory=lambda: os.environ.get("KEYCLOAK_REALM", "caipe")
    )
    client_id: str = field(
        default_factory=lambda: os.environ.get(
            "KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID", "caipe-platform"
        )
    )
    client_secret: Optional[str] = field(
        default_factory=lambda: os.environ.get("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET")
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


# Keycloak 26+ enforces the "user-profile" config on every Admin API PUT,
# which means a partial body that omits required fields like `email` is
# rejected with HTTP 400 "error-user-attribute-required" — even if the
# field is unchanged on disk. Round-trip these identity fields from the
# GET response so PUTs that are conceptually "patch attributes only"
# still satisfy the user-profile validator.
# See: https://www.keycloak.org/docs/26/server_admin/index.html#user-profile
_USER_PROFILE_ROUNDTRIP_FIELDS = (
    "username",
    "email",
    "firstName",
    "lastName",
    "emailVerified",
    "enabled",
)


def _user_profile_roundtrip(user_repr: dict) -> dict:
    """Pluck Keycloak 26 user-profile-required fields off a UserRepresentation
    so callers performing attribute-only PUTs can re-include them in the body.

    Returns only fields that are present in the source repr — no defaulting,
    so a missing field stays missing rather than getting silently set to
    None and tripping a different validator.
    """
    return {
        field: user_repr[field]
        for field in _USER_PROFILE_ROUNDTRIP_FIELDS
        if field in user_repr
    }


async def set_user_attribute(
    user_id: str,
    attr: str,
    value: str,
    config: KeycloakAdminConfig | None = None,
) -> None:
    """Set or overwrite a single user attribute on a Keycloak user.

    Reads the current attributes to avoid clobbering unrelated ones,
    then PUTs the updated representation. Re-includes Keycloak 26's
    user-profile-required identity fields (email, username, ...) in
    the PUT body so the user-profile validator does not reject the
    partial update.
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

        body = _user_profile_roundtrip(user_repr)
        body["attributes"] = attributes

        put_resp = await client.put(
            url,
            json=body,
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

        body = _user_profile_roundtrip(user_repr)
        body["attributes"] = attributes

        put_resp = await client.put(
            url,
            json=body,
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


def _rfc3339_now() -> str:
    """RFC3339 timestamp in UTC with second precision (e.g.
    ``2026-04-22T18:05:11Z``). Used as the value of the ``created_at``
    user attribute (FR-003)."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


async def create_user_from_slack(
    slack_user_id: str,
    email: str,
    config: KeycloakAdminConfig | None = None,
) -> str:
    """Create a federated-only Keycloak shell user for a Slack identity.

    Implements spec 103 FR-002 / FR-003 / FR-008:

    * ``POST /admin/realms/{realm}/users`` with the body shape pinned in
      FR-003 (no password, no required actions, ``emailVerified=true``,
      ``slack_user_id``/``created_by``/``created_at`` attributes).
    * Parses the new user UUID from the ``Location`` header.
    * On HTTP 409 ("conflict — user already exists"), re-queries by
      email and returns the existing user's UUID, treating the race as
      benign (FR-008).
    * On 401/403/5xx/network error, raises a typed :class:`JitError`
      subclass; callers log per FR-011 and fall through to the
      link-based onboarding flow.
    * Helper-shape mitigation (spec M1): this function is the only
      Keycloak Admin write surface in slack-bot. Any future need to
      mutate user records should add a separate, narrowly-scoped helper
      rather than exposing a generic "PUT any user" call.

    The caller is expected to pass an *unvalidated* Slack profile email;
    this helper does NOT enforce the optional
    ``SLACK_JIT_ALLOWED_EMAIL_DOMAINS`` allowlist — that lives in
    ``identity_linker.auto_bootstrap_slack_user`` so the gating decision
    sits next to the JIT-on/off feature flag.
    """
    cfg = config or _default_config
    token = await _get_admin_token(cfg)

    email_lower = email.strip().lower()
    body = {
        "username": email_lower,
        "email": email_lower,
        "emailVerified": True,
        "enabled": True,
        "requiredActions": [],
        "attributes": {
            "slack_user_id": [slack_user_id],
            "created_by": ["slack-bot:jit"],
            "created_at": [_rfc3339_now()],
        },
    }

    users_url = f"{cfg.server_url}/admin/realms/{cfg.realm}/users"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(users_url, json=body, headers=headers)
    except httpx.HTTPError as exc:
        raise JitNetworkError(str(exc)) from exc

    if resp.status_code == 401:
        raise JitAuthError("Keycloak rejected admin token (401)")
    if resp.status_code == 403:
        raise JitForbiddenError(
            "Admin client lacks 'manage-users' role (403). "
            "Check service-account-caipe-platform realm-management mappings."
        )
    if resp.status_code == 409:
        # Race: another concurrent Slack request created this user
        # between our lookup and POST. Re-query by email and return
        # the surviving record (FR-008).
        existing = await get_user_by_email(email_lower, config=cfg)
        if existing and existing.get("id"):
            kc_user_id = str(existing["id"])
            logger.info(
                "JIT 409 conflict resolved by re-query: slack=%s -> kc=%s",
                slack_user_id,
                kc_user_id,
            )
            return kc_user_id
        # Conflict but re-query found nothing — treat as a server-side
        # inconsistency rather than a happy-path resolution.
        raise JitServerError(
            "Keycloak returned 409 but follow-up email lookup found no user"
        )
    if 500 <= resp.status_code < 600:
        raise JitServerError(f"Keycloak {resp.status_code} on POST /users")
    if resp.status_code not in (200, 201):
        raise JitServerError(
            f"Unexpected Keycloak response {resp.status_code} on POST /users"
        )

    # Happy path: parse the new user's UUID from the Location header.
    location = resp.headers.get("Location") or resp.headers.get("location") or ""
    new_id = location.rsplit("/", 1)[-1].strip()
    if not new_id:
        # Some Keycloak builds (and older proxy configurations) strip the
        # Location header; fall back to a query-by-email so we still return
        # a usable id.
        existing = await get_user_by_email(email_lower, config=cfg)
        if existing and existing.get("id"):
            new_id = str(existing["id"])
    if not new_id:
        raise JitServerError(
            "POST /users succeeded but no user id could be resolved"
        )
    return new_id
