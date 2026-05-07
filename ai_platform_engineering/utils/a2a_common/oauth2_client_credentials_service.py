# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""OAuth2 client_credentials token service for outbound A2A m2m auth.

Implements the a2a-sdk `CredentialService` protocol so A2A clients (with
`AuthInterceptor` attached) can transparently mint and forward Bearer
tokens when calling agents that advertise an OAuth2 security scheme on
their AgentCard.

Reads from env (matches the convention already used by the inbound
OAuth2Middleware in `ai_platform_engineering.utils.auth.oauth2_middleware`):

  - OAUTH2_CLIENT_ID      — confidential client id
  - OAUTH2_CLIENT_SECRET  — confidential client secret
  - TOKEN_ENDPOINT        — IdP's RFC6749 §3.2 token endpoint URL

Refreshes proactively at 80% of token TTL but keeps the existing token
until its actual `exp` if a refresh fails (transient IdP outage). Single
asyncio.Lock per process serializes refreshes to avoid thundering herd.
"""

import asyncio
import logging
import os
import time
from urllib.parse import urlparse

import httpx
import jwt
from a2a.client.auth.credentials import CredentialService
from a2a.client.middleware import ClientCallContext

logger = logging.getLogger(__name__)

# Default token TTL (seconds) when the issued token is opaque (not a JWT)
# or its `exp` claim cannot be decoded. Conservative: short enough that a
# stale token won't outlive a typical IdP rotation, long enough to avoid
# minting on every request.
_DEFAULT_OPAQUE_TOKEN_TTL = 60.0

# Hostnames considered acceptable for plaintext (http://) token endpoints.
# Loopback only — anything else triggers a warning because client_secret
# would travel in plaintext over the wire.
_PLAINTEXT_OK_HOSTS = frozenset({'localhost', '127.0.0.1', '::1'})

_TOKEN_ENDPOINT_VALIDATED = False


def _validate_token_endpoint_scheme(token_endpoint: str) -> None:
    """Warn (once per process) if TOKEN_ENDPOINT uses plaintext over a non-loopback host.

    Refuses to escalate to an exception so misconfigured operators see
    auth failures (clear) rather than crash loops (confusing). The warning
    surfaces in startup logs.
    """
    global _TOKEN_ENDPOINT_VALIDATED
    if _TOKEN_ENDPOINT_VALIDATED:
        return
    _TOKEN_ENDPOINT_VALIDATED = True
    parsed = urlparse(token_endpoint)
    if parsed.scheme == 'https':
        return
    if parsed.scheme == 'http' and parsed.hostname in _PLAINTEXT_OK_HOSTS:
        logger.info(
            "TOKEN_ENDPOINT uses plaintext http:// to a loopback host (%s) — "
            "acceptable for local development only.",
            parsed.hostname,
        )
        return
    logger.warning(
        "TOKEN_ENDPOINT scheme is %r (not https). Client secret will travel "
        "in plaintext over the wire on each token mint. Use https:// in any "
        "non-loopback environment.",
        parsed.scheme or '(missing)',
    )


def _scrub_secret(text: str, secret: str) -> str:
    """Redact `secret` from `text`. Cheap belt-and-suspenders for log lines.

    `httpx` doesn't include request bodies in default exception reprs, but
    some IdPs echo `client_secret` back in their error responses (e.g.
    "invalid_client_secret: <secret>"). Scrubbing here ensures the secret
    never leaks via the credential service's own error path.
    """
    if not secret or not text:
        return text
    return text.replace(secret, '***REDACTED***')


class OAuth2ClientCredentialsService(CredentialService):
    """Mints + caches OAuth2 client_credentials access tokens.

    Hard-coded to scheme name 'oauth2' to match what `A2AServer`'s patched
    `_build_security_for_card()` advertises. Agents using a different
    scheme name should subclass and override `SCHEME_NAME`.

    One instance per `AuthInterceptor` — token cache is per-instance, not
    per-process. Multiple instances minting against the same IdP/client is
    inefficient but not unsafe.
    """

    SCHEME_NAME = 'oauth2'

    def __init__(self):
        self._lock = asyncio.Lock()
        self._token: str | None = None
        self._token_exp: float = 0.0       # actual token exp (seconds since epoch)
        self._refresh_after: float = 0.0   # 80% of TTL — soft refresh deadline

    async def get_credentials(
        self,
        security_scheme_name: str,
        context: ClientCallContext | None,
    ) -> str | None:
        """Return a valid access token for the named scheme, or None."""
        if security_scheme_name != self.SCHEME_NAME:
            return None
        async with self._lock:
            now = time.time()  # capture inside lock to avoid TOCTOU
            if not self._token or now >= self._refresh_after:
                try:
                    await self._refresh()
                except Exception as exc:  # noqa: BLE001
                    # Stale-on-error: serve the existing token until its
                    # actual exp if a refresh fails (transient IdP outage).
                    now = time.time()
                    if self._token and now < self._token_exp:
                        logger.warning(
                            "OAuth2 token refresh failed; using stale token "
                            "until exp (%ds remaining): %s",
                            int(self._token_exp - now),
                            exc,
                        )
                    else:
                        logger.error(
                            "OAuth2 token refresh failed and no usable token: %s",
                            exc,
                        )
                        raise
            return self._token

    async def _refresh(self) -> None:
        client_id = os.environ['OAUTH2_CLIENT_ID']
        client_secret = os.environ['OAUTH2_CLIENT_SECRET']
        token_endpoint = os.environ['TOKEN_ENDPOINT']
        _validate_token_endpoint_scheme(token_endpoint)

        # `trust_env=True` honors HTTPS_PROXY / NO_PROXY / corporate CA
        # bundles via REQUESTS_CA_BUNDLE — typical in enterprise networks.
        async with httpx.AsyncClient(timeout=10, trust_env=True) as client:
            try:
                resp = await client.post(
                    token_endpoint,
                    data={
                        'grant_type': 'client_credentials',
                        'client_id': client_id,
                        'client_secret': client_secret,
                    },
                )
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                # Some IdPs echo the request body in error responses — scrub
                # client_secret from any string we might log via the caller.
                scrubbed_msg = _scrub_secret(str(exc), client_secret)
                raise httpx.HTTPStatusError(
                    scrubbed_msg, request=exc.request, response=exc.response
                ) from None
            data = resp.json()
            self._token = data['access_token']

            # Decode without signature verification to extract `exp` for
            # caching. We trust this token because we just minted it from
            # our own configured IdP — signature verification happens at
            # the receiving agent via OAuth2Middleware. Falls back to a
            # short default TTL if the token is opaque (not a JWT) or the
            # exp claim is missing.
            now = time.time()
            try:
                decoded = jwt.decode(
                    self._token, options={'verify_signature': False}
                )
                self._token_exp = float(
                    decoded.get('exp', now + _DEFAULT_OPAQUE_TOKEN_TTL)
                )
            except jwt.PyJWTError:
                # Opaque token — no `exp` to extract. Use conservative default.
                logger.debug(
                    "Issued token is not a JWT; using conservative default "
                    "TTL of %ds for cache eviction.",
                    int(_DEFAULT_OPAQUE_TOKEN_TTL),
                )
                self._token_exp = now + _DEFAULT_OPAQUE_TOKEN_TTL

            ttl = self._token_exp - now
            self._refresh_after = now + max(ttl * 0.8, 30.0)
            logger.info(
                "Minted OAuth2 client_credentials token for client_id=%s "
                "(TTL=%ds, refresh_after=%ds)",
                client_id,
                int(ttl),
                int(self._refresh_after - now),
            )
