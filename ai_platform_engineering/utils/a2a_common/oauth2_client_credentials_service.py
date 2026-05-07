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

import httpx
import jwt
from a2a.client.auth.credentials import CredentialService
from a2a.client.middleware import ClientCallContext

logger = logging.getLogger(__name__)


class OAuth2ClientCredentialsService(CredentialService):
    """Mints + caches OAuth2 client_credentials access tokens.

    Hard-coded to scheme name 'oauth2' to match what `A2AServer`'s patched
    `_build_security_for_card()` advertises. Agents using a different
    scheme name should subclass and override `SCHEME_NAME`.
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
        now = time.time()
        async with self._lock:
            if not self._token or now >= self._refresh_after:
                try:
                    await self._refresh()
                except Exception as exc:  # noqa: BLE001
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
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                token_endpoint,
                data={
                    'grant_type': 'client_credentials',
                    'client_id': client_id,
                    'client_secret': client_secret,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            self._token = data['access_token']
            decoded = jwt.decode(
                self._token, options={'verify_signature': False}
            )
            now = time.time()
            self._token_exp = float(decoded.get('exp', now + 60))
            ttl = self._token_exp - now
            self._refresh_after = now + max(ttl * 0.8, 30.0)
            logger.info(
                "Minted OAuth2 client_credentials token for client_id=%s "
                "(TTL=%ds, refresh_after=%ds)",
                client_id,
                int(ttl),
                int(self._refresh_after - now),
            )
