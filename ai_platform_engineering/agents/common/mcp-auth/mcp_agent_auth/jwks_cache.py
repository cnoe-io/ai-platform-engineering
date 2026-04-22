import requests
import logging
from typing import Dict, Optional
import time
DEFAULT_JWKS_TTL = 3600                   # Fallback TTL (seconds) if JWKS lacks cache headers
HTTP_TIMEOUT = 3                         # Seconds for JWKS HTTP calls

logger = logging.getLogger(__name__)


class JwksCache:
    """
    Caches JWKS (public signing keys) to avoid a network call per request.
    - Respects Cache-Control: max-age when present.
    - Falls back to DEFAULT_JWKS_TTL otherwise.
    - Refreshes on demand if 'kid' not found (key rotation).
    """

    def __init__(self, jwks_uri: str, ttl_seconds: int = DEFAULT_JWKS_TTL):
        self.jwks_uri = jwks_uri
        self.ttl_seconds = ttl_seconds
        self._keys_by_kid: Dict[str, dict] = {}
        self._expires_at = 0.0
        self._session = requests.Session()

    def _parse_ttl_from_headers(self, resp: requests.Response) -> int:
        # Honor Cache-Control: max-age if provided by the IdP.
        cache_control = resp.headers.get("Cache-Control", "")
        for part in cache_control.split(","):
            part = part.strip().lower()
            if part.startswith("max-age="):
                try:
                    return int(part.split("=", 1)[1])
                except ValueError:
                    # Ignore bad max-age values and use the default TTL.
                    pass
        return self.ttl_seconds

    def refresh(self) -> None:
        # Fetch and cache JWKS. If network fails, propagate to caller.
        r = self._session.get(self.jwks_uri, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        body = r.json()
        keys = body.get("keys", [])
        self._keys_by_kid = {k.get("kid"): k for k in keys if "kid" in k}
        ttl = self._parse_ttl_from_headers(r)
        self._expires_at = time.time() + ttl
        logger.debug("JWKS refreshed; %d keys; TTL=%ds", len(self._keys_by_kid), ttl)

    def get_jwk(self, kid: str) -> Optional[dict]:
        """
        Returns the JWK for the given kid, refreshing if:
        - Cache expired, or
        - kid is missing (possible key rotation).
        """
        now = time.time()
        # Refresh if cache empty or expired.
        if now >= self._expires_at or not self._keys_by_kid:
            try:
                self.refresh()
            except Exception as e:
                logger.warning("JWKS refresh failed; using stale cache if available: %s", e)

        jwk = self._keys_by_kid.get(kid)
        if jwk is None:
            # Unknown kid — try one forced refresh (key rotation scenario).
            logger.info("Unknown kid '%s'; attempting JWKS refresh.", kid)
            try:
                self.refresh()
                jwk = self._keys_by_kid.get(kid)
            except Exception as e:
                logger.warning("JWKS refresh failed on unknown kid: %s", e)
        return jwk