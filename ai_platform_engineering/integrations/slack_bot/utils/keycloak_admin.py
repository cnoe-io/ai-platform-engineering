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
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

from .bff_client import bff_headers, resolve_bff_base_url, service_account_token

logger = logging.getLogger("caipe.slack_bot.keycloak_admin")


# --------------------------------------------------------------------------- #
# JIT (Just-in-Time) user creation                                            #
# --------------------------------------------------------------------------- #
#
# JIT is the path that creates a Keycloak shell user the first time a Slack
# user DMs the bot, when no Keycloak user with their email exists yet.
#
# Since issue #1781, JIT does NOT touch the Keycloak Admin API from the
# slack-bot. Instead ``create_user_from_slack`` calls the first-party BFF
# endpoint ``POST /api/admin/users/provision-shell`` (Next.js UI), which is
# the single canonical create-or-resolve implementation shared with the
# Okta / IdP directory sync. This removes the layering smell of a bot
# reaching Keycloak Admin directly and collapses two language-duplicated
# spec-103 implementations into one.
#
# Auth: the call carries the bot's own service-account bearer token plus
# ``X-Client-Source: slack-bot`` (see :mod:`bff_client`), and the BFF graphs
# it as ``service_account:<sub>`` gated on ``admin_surface:user_provisioning``
# in OpenFGA. The ``KEYCLOAK_SLACK_BOT_ADMIN_*`` credentials are still used by
# the *lookup / attribute* helpers in this module (``get_user_by_*``,
# ``set_user_attribute``), which were not in scope for #1781 — only user
# *creation* moved behind the BFF.


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


async def get_user_by_id(
    user_id: str,
    config: KeycloakAdminConfig | None = None,
) -> Optional[dict[str, Any]]:
    """Fetch a Keycloak user by their internal ``id`` (the JWT ``sub``).

    Returns the full UserRepresentation dict (including ``email``) or
    ``None`` on 404. Used by the channel→team resolver so it can match
    Mongo's email-keyed team membership against the bot's KC-UUID-keyed
    identity context.
    """
    cfg = config or _default_config
    token = await _get_admin_token(cfg)
    url = f"{cfg.server_url}/admin/realms/{cfg.realm}/users/{user_id}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()


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


# Source tag recorded as the ``created_by`` attribute on JIT users the bot
# provisions, so the origin of a shell account is auditable in Keycloak.
_SLACK_JIT_SOURCE = "slack-bot:jit"

# The BFF endpoint timeout. Generous relative to the ~10s used for direct
# Keycloak calls because the BFF itself does a lookup + create round-trip to
# Keycloak on a miss.
_PROVISION_TIMEOUT_SECONDS = 15.0


# --------------------------------------------------------------------------- #
# IdP broker / federation helpers (anonymous-and-obo-routing)                #
# --------------------------------------------------------------------------- #
#
# These are NEVER-THROW helpers: any HTTP, timeout, or parse error returns a
# conservative (fail-closed) default value so the caller can make a safe
# routing decision without crashing the middleware.

# user_is_federated cache: {kc_user_id: (result: bool, cached_at: float)}
_USER_FEDERATED_TTL: float = float(os.environ.get("KC_USER_FEDERATED_TTL_SECONDS", "60"))
_user_federated_cache: dict[str, tuple[bool, float]] = {}

# realm_has_enabled_idp_broker cache: (result: bool, cached_at: float)
_BROKER_CACHE_TTL: float = float(os.environ.get("KC_BROKER_CACHE_TTL_SECONDS", "300"))
_broker_cache: tuple[bool | None, float] = (None, 0.0)
# Last-known-good broker result (SEC-2): on Keycloak transient errors we return
# the last successful result instead of defaulting to False (fail-open).
# Only falls back to False when we have NEVER successfully contacted Keycloak.
_broker_last_known_good: bool | None = None


def _invalidate_user_federated_cache(kc_user_id: str | None = None) -> None:
    """Clear the user_is_federated cache.  Pass a kc_user_id to clear just
    that entry, or ``None`` to clear all."""
    if kc_user_id is None:
        _user_federated_cache.clear()
    else:
        _user_federated_cache.pop(kc_user_id, None)


def _invalidate_broker_cache() -> None:
    """Force the next realm_has_enabled_idp_broker call to re-query Keycloak."""
    global _broker_cache
    _broker_cache = (None, 0.0)
    # Note: _broker_last_known_good is intentionally NOT cleared here — it
    # represents the last confirmed truth, not the cache TTL state.


async def user_is_federated(
    keycloak_user_id: str,
    config: KeycloakAdminConfig | None = None,
) -> bool:
    """Return ``True`` when the Keycloak user has at least one live IdP link.

    Uses ``GET /admin/realms/{realm}/users/{id}`` which embeds
    ``federatedIdentities`` (unlike the ``?q=`` search endpoint).

    Fail-closed: on ANY error (HTTP, timeout, parse) logs a warning and
    returns ``False`` — a non-federated classification — so the caller
    treats the user as anonymous when a broker is present.  This is the
    safe direction: it's better to briefly over-route a federated user as
    anonymous than to allow an unverified JIT shell to run as themselves.

    Per-user-id TTL cache of 60 s (configurable via
    ``KC_USER_FEDERATED_TTL_SECONDS``) mirrors the monotonic-time pattern
    in :class:`~utils.service_account_resolver.ServiceAccountResolver`.
    """
    now = time.monotonic()
    cached = _user_federated_cache.get(keycloak_user_id)
    if cached is not None:
        result, cached_at = cached
        if now - cached_at < _USER_FEDERATED_TTL:
            return result

    try:
        cfg = config or _default_config
        token = await _get_admin_token(cfg)
        url = f"{cfg.server_url}/admin/realms/{cfg.realm}/users/{keycloak_user_id}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
            resp.raise_for_status()
            user = resp.json()
        result = bool(user.get("federatedIdentities"))
    except Exception as exc:
        logger.warning(
            "user_is_federated: lookup failed for kc_id=%s (fail-closed → False): %s",
            keycloak_user_id,
            exc,
        )
        result = False

    _user_federated_cache[keycloak_user_id] = (result, now)
    return result


async def realm_has_enabled_idp_broker(
    config: KeycloakAdminConfig | None = None,
) -> bool:
    """Return ``True`` when the realm has at least one ENABLED IdP broker.

    Uses ``GET /admin/realms/{realm}/identity-provider/instances``.

    On error: returns the last-known-good result if we have ever succeeded;
    only falls back to ``False`` (no broker) when we have NEVER successfully
    contacted Keycloak (SEC-2).  This prevents a transient Keycloak blip
    from silently promoting JIT/unverified users to full user access.

    Process-wide TTL cache of 300 s (configurable via
    ``KC_BROKER_CACHE_TTL_SECONDS``) — broker configuration changes at
    deploy time, not per request.
    """
    global _broker_cache, _broker_last_known_good
    now = time.monotonic()
    cached_result, cached_at = _broker_cache
    if cached_result is not None and now - cached_at < _BROKER_CACHE_TTL:
        return cached_result

    try:
        cfg = config or _default_config
        token = await _get_admin_token(cfg)
        url = f"{cfg.server_url}/admin/realms/{cfg.realm}/identity-provider/instances"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
            resp.raise_for_status()
            instances = resp.json()
        result = any(i.get("enabled") for i in instances)
        _broker_last_known_good = result  # SEC-2: update last-known-good on success
    except Exception as exc:
        if _broker_last_known_good is not None:
            logger.warning(
                "realm_has_enabled_idp_broker: lookup failed — using last-known-good "
                "result (%s) to prevent inadvertent access promotion: %s",
                _broker_last_known_good,
                exc,
            )
            result = _broker_last_known_good
        else:
            logger.warning(
                "realm_has_enabled_idp_broker: lookup failed and no prior result "
                "available — defaulting to False (no broker): %s",
                exc,
            )
            result = False

    _broker_cache = (result, now)
    return result


async def create_user_from_slack(
    slack_user_id: str,
    email: str,
    config: KeycloakAdminConfig | None = None,
) -> str:
    """Create-or-resolve a federated-only Keycloak shell user for a Slack identity.

    Since issue #1781 this calls the first-party BFF endpoint
    ``POST /api/admin/users/provision-shell`` rather than the Keycloak Admin
    API directly. The BFF owns the canonical spec-103 shape (lowercased email
    as username+email, no password, no required actions, ``emailVerified=true``,
    409 → re-query) and the ``created_by`` / ``created_at`` audit attributes;
    this function supplies the ``slack_user_id`` attribute and the
    ``slack-bot:jit`` source tag.

    Behaviour preserved for callers (idempotency, attributes, returns the
    Keycloak ``sub``). Error mapping → typed :class:`JitError` subclass so
    ``identity_linker`` keeps keying off ``error_kind`` (FR-011):

    * 401 → :class:`JitAuthError`   (BFF rejected the bot's bearer token)
    * 403 → :class:`JitForbiddenError` (bot SA lacks the provisioning grant)
    * 5xx / unexpected status → :class:`JitServerError`
    * network / unconfigured BFF → :class:`JitNetworkError`

    ``config`` is accepted for signature compatibility with the old direct-Admin
    implementation but is unused — auth now flows through the bot's
    service-account token (see :mod:`bff_client`).

    The caller passes an *unvalidated* Slack profile email; this helper does
    NOT enforce the optional ``SLACK_JIT_ALLOWED_EMAIL_DOMAINS`` allowlist —
    that lives in ``identity_linker.auto_bootstrap_slack_user`` so the gating
    decision sits next to the JIT-on/off feature flag.
    """
    del config  # signature-compat only; see docstring.

    email_lower = email.strip().lower()

    base_url = resolve_bff_base_url()
    if not base_url:
        # No BFF configured — there is nowhere to provision. Surface as a
        # network-class failure so the caller falls back to link-onboarding.
        raise JitNetworkError(
            "No CAIPE BFF base URL configured (set CAIPE_UI_URL / CAIPE_API_URL); "
            "cannot provision shell user"
        )

    url = f"{base_url}/api/admin/users/provision-shell"
    payload = {
        "email": email_lower,
        "source": _SLACK_JIT_SOURCE,
        "attributes": {"slack_user_id": [slack_user_id]},
    }
    headers = bff_headers(bearer_token=service_account_token(), json_body=True)

    try:
        async with httpx.AsyncClient(timeout=_PROVISION_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise JitNetworkError(str(exc)) from exc

    if resp.status_code == 401:
        raise JitAuthError("BFF rejected the bot service-account token (401)")
    if resp.status_code == 403:
        raise JitForbiddenError(
            "BFF denied shell-user provisioning (403). The slack-bot service "
            "account needs 'writer admin_surface:user_provisioning' in OpenFGA."
        )
    if 500 <= resp.status_code < 600:
        raise JitServerError(
            f"BFF {resp.status_code} on POST /api/admin/users/provision-shell"
        )
    if resp.status_code not in (200, 201):
        raise JitServerError(
            f"Unexpected BFF response {resp.status_code} on "
            "POST /api/admin/users/provision-shell"
        )

    try:
        body = resp.json()
    except ValueError as exc:
        raise JitServerError(f"BFF provision-shell returned non-JSON body: {exc}") from exc

    # Envelope is {"success": true, "data": {"sub": "...", "created": bool}}.
    data = body.get("data") if isinstance(body, dict) else None
    sub = data.get("sub") if isinstance(data, dict) else None
    if not sub:
        raise JitServerError(
            "BFF provision-shell succeeded but returned no 'sub'"
        )

    created = bool(data.get("created")) if isinstance(data, dict) else False
    logger.info(
        "JIT provisioned via BFF: event=jit_%s slack=%s keycloak=%s",
        "created" if created else "resolved",
        slack_user_id,
        sub,
    )
    return str(sub)
