"""Slack-bot user-directory client — all Keycloak access flows through the BFF.

This module is the Slack bot's thin client for Keycloak user operations. It
holds **no** Keycloak Admin credentials of its own: every call goes to a
first-party CAIPE BFF (Next.js UI) endpoint carrying the bot's own
service-account bearer token plus ``X-Client-Source: slack-bot`` (see
:mod:`bff_client`). The BFF graphs the bot as ``service_account:<sub>`` and
authorizes each call with an explicit OpenFGA grant:

* JIT create-or-resolve  → ``POST /api/admin/users/provision-shell``
  (gated ``writer admin_surface:user_provisioning`` — issue #1781).
* user-directory lookups → ``GET  /api/admin/users/resolve``
  (gated ``reader admin_surface:user_directory``).
* attribute merge        → ``PATCH /api/admin/users/{id}/attributes``
  (gated ``writer admin_surface:user_directory``).

The grants are seeded by ``init-token-exchange.sh``. This replaces the bot's
former direct Keycloak Admin REST access (the ``KEYCLOAK_SLACK_BOT_ADMIN_*``
client-credentials path), removing the layering smell of a bot holding
realm-management credentials. The token does service-to-service auth; the
OpenFGA grants are its RBAC.
"""

# assisted-by Codex Codex-sonnet-4-6

from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional
from urllib.parse import quote

import httpx

from .bff_client import bff_headers, resolve_bff_base_url, service_account_token

logger = logging.getLogger("caipe.slack_bot.keycloak_admin")


# --------------------------------------------------------------------------- #
# JIT (Just-in-Time) user creation                                            #
# --------------------------------------------------------------------------- #
#
# JIT is the path that creates a Keycloak shell user the first time a Slack
# user DMs the bot, when no Keycloak user with their email exists yet. Since
# issue #1781 it calls the BFF endpoint ``POST /api/admin/users/provision-shell``
# (the single canonical create-or-resolve implementation, shared with the
# Okta / IdP directory sync) rather than the Keycloak Admin API directly.


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


# The BFF endpoint timeout for lookups / attribute writes. Matches the ~10s the
# bot previously used for direct Keycloak calls.
_BFF_TIMEOUT_SECONDS = 10.0


def _require_bff_base_url(operation: str) -> str:
    """Return the configured BFF base URL or raise.

    These directory operations have no graceful "no-BFF" fallback (unlike JIT,
    which degrades to link-onboarding) — an unconfigured BFF is a deployment
    error, surfaced by raising so it propagates exactly as a transport error
    would have on the old direct-Admin path.
    """
    base_url = resolve_bff_base_url()
    if not base_url:
        raise RuntimeError(
            f"No CAIPE BFF base URL configured (set CAIPE_UI_URL / CAIPE_API_URL); "
            f"cannot {operation}"
        )
    return base_url


def _user_from_resolve(body: Any) -> Optional[dict[str, Any]]:
    """Map a ``GET /api/admin/users/resolve`` envelope to a Keycloak-ish dict.

    The BFF returns ``{success, data: {sub, enabled, attributes} | null}``.
    Callers (``identity_linker`` / ``channel_team_mapper``) read ``id``,
    ``enabled`` and ``attributes`` off the result, so we map ``sub``→``id`` and
    leave their access patterns untouched. Returns ``None`` for a "no match"
    (``data: null``).
    """
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, dict):
        return None
    return {
        "id": data.get("sub"),
        "enabled": data.get("enabled", True),
        "attributes": data.get("attributes", {}),
    }


async def _resolve_user(params: dict[str, str]) -> Optional[dict[str, Any]]:
    """Call ``GET /api/admin/users/resolve`` with the given query params.

    Raises on an unexpected (non-2xx) status — matching the old direct-Admin
    functions' ``raise_for_status`` — and returns ``None`` on a clean "no
    match" (``data: null``).
    """
    base_url = _require_bff_base_url("resolve Keycloak user")
    url = f"{base_url}/api/admin/users/resolve"
    headers = bff_headers(bearer_token=service_account_token())

    async with httpx.AsyncClient(timeout=_BFF_TIMEOUT_SECONDS) as client:
        resp = await client.get(url, params=params, headers=headers)
        resp.raise_for_status()
        return _user_from_resolve(resp.json())


async def get_user_by_attribute(attr: str, value: str) -> Optional[dict[str, Any]]:
    """Find a Keycloak user whose attribute *attr* equals *value*.

    Returns the matching user dict (keyed by ``id``), or ``None`` if no match.
    Routed through ``GET /api/admin/users/resolve?attribute=&value=``.
    """
    return await _resolve_user({"attribute": attr, "value": value})


async def get_user_by_email(email: str) -> Optional[dict[str, Any]]:
    """Find a Keycloak user by exact email match.

    Returns the matching user dict (keyed by ``id``), or ``None`` if not found.
    Routed through ``GET /api/admin/users/resolve?email=``.
    """
    return await _resolve_user({"email": email})


async def get_user_attribute(user_id: str, attr: str) -> Optional[str]:
    """Read a single user attribute value. Returns ``None`` if absent.

    Routed through ``GET /api/admin/users/resolve?id=``, then reads
    ``attributes[attr][0]`` off the resolved record.
    """
    user = await _resolve_user({"id": user_id})
    if user is None:
        return None
    vals = user.get("attributes", {}).get(attr, [])
    return vals[0] if vals else None


async def set_user_attribute(user_id: str, attr: str, value: str) -> None:
    """Set or overwrite a single user attribute on a Keycloak user.

    Routed through ``PATCH /api/admin/users/{id}/attributes`` with
    ``{attributes: {attr: [value]}}``. The BFF owns the merge semantics (other
    attributes preserved) and the Keycloak-26 user-profile round-trip the bot
    previously had to replicate itself.
    """
    base_url = _require_bff_base_url("set Keycloak user attribute")
    url = f"{base_url}/api/admin/users/{quote(user_id, safe='')}/attributes"
    payload = {"attributes": {attr: [value]}}
    headers = bff_headers(bearer_token=service_account_token(), json_body=True)

    async with httpx.AsyncClient(timeout=_BFF_TIMEOUT_SECONDS) as client:
        resp = await client.patch(url, json=payload, headers=headers)
        resp.raise_for_status()
        logger.info("Set attribute %s on user %s via BFF", attr, user_id)


# Source tag recorded as the ``created_by`` attribute on JIT users the bot
# provisions, so the origin of a shell account is auditable in Keycloak.
_SLACK_JIT_SOURCE = "slack-bot:jit"

# The provision-shell timeout. Generous relative to lookups/writes because the
# BFF itself does a lookup + create round-trip to Keycloak on a miss.
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


def _bff_headers(json_body: bool = False) -> dict[str, str]:
    return bff_headers(bearer_token=service_account_token(), json_body=json_body)


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
) -> bool:
    """Return ``True`` when the Keycloak user has at least one live IdP link.

    Uses the BFF-backed ``GET /api/admin/users/resolve?id=...`` contract so
    the Slack bot does not hold Keycloak Admin credentials.

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
        base_url = _require_bff_base_url("resolve Keycloak user federation")
        url = f"{base_url}/api/admin/users/resolve"
        async with httpx.AsyncClient(timeout=_BFF_TIMEOUT_SECONDS) as client:
            resp = await client.get(
                url,
                params={"id": keycloak_user_id},
                headers=_bff_headers(),
            )
            resp.raise_for_status()
            body = resp.json()
        data = body.get("data") if isinstance(body, dict) else None
        identities = (
            data.get("federatedIdentities")
            if isinstance(data, dict)
            else None
        )
        result = bool(identities)
    except Exception as exc:
        logger.warning(
            "user_is_federated: BFF lookup failed for kc_id=%s "
            "(fail-closed → False): %s",
            keycloak_user_id,
            exc,
        )
        result = False

    _user_federated_cache[keycloak_user_id] = (result, now)
    return result


async def realm_has_enabled_idp_broker(
) -> bool:
    """Return ``True`` when the realm has at least one ENABLED IdP broker.

    Uses the BFF-backed ``GET /api/admin/realm/identity-providers`` contract
    so the Slack bot does not hold Keycloak Admin credentials.

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
        base_url = _require_bff_base_url("resolve Keycloak IdP broker state")
        url = f"{base_url}/api/admin/realm/identity-providers"
        async with httpx.AsyncClient(timeout=_BFF_TIMEOUT_SECONDS) as client:
            resp = await client.get(url, headers=_bff_headers())
            resp.raise_for_status()
            body = resp.json()
        data = body.get("data") if isinstance(body, dict) else None
        result = bool(data.get("hasEnabledBroker")) if isinstance(data, dict) else False
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
) -> str:
    """Create-or-resolve a federated-only Keycloak shell user for a Slack identity.

    Calls the first-party BFF endpoint ``POST /api/admin/users/provision-shell``
    (issue #1781). The BFF owns the canonical spec-103 shape (lowercased email
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

    The caller passes an *unvalidated* Slack profile email; this helper does
    NOT enforce the optional ``SLACK_JIT_ALLOWED_EMAIL_DOMAINS`` allowlist —
    that lives in ``identity_linker.auto_bootstrap_slack_user`` so the gating
    decision sits next to the JIT-on/off feature flag.
    """
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
