"""
Authentication module for RAG server with JWT validation.

Supports multiple OIDC providers (UI and Ingestor) with JWKS-based validation.
"""

import os
import time
from typing import Dict, Any, Tuple, Optional
from functools import lru_cache
import httpx
from jose import jwt, JWTError
from common import utils

logger = utils.get_logger(__name__)


class OIDCProvider:
  """Represents an OIDC provider configuration with JWKS caching."""

  def __init__(self, issuer: str, audience: str, name: str, discovery_url: Optional[str] = None):
    """
    Initialize OIDC provider.

    Args:
        issuer: OIDC issuer URL (e.g., https://keycloak.example.com/realms/production)
        audience: Expected audience claim (typically client_id)
        name: Human-readable name for this provider (e.g., "ui", "ingestor")
        discovery_url: Optional explicit discovery URL (if not provided, constructs from issuer)
    """
    self.issuer = issuer
    self.audience = audience
    self.name = name
    self.discovery_url = discovery_url
    self.jwks_uri: Optional[str] = None
    self.jwks_cache: Dict[str, Any] = {}
    self.jwks_cache_time: float = 0
    self.jwks_cache_ttl: int = 3600  # Cache JWKS for 1 hour

    if discovery_url:
      logger.info(f"Initialized OIDC provider '{name}': issuer={issuer}, audience={audience}, discovery_url={discovery_url}")
    else:
      logger.info(f"Initialized OIDC provider '{name}': issuer={issuer}, audience={audience}")

  async def _fetch_jwks(self) -> Dict[str, Any]:
    """
    Fetch JWKS (JSON Web Key Set) from OIDC provider.

    Strategy:
    1. Try explicit discovery URL if provided
    2. Fallback to constructing from issuer if discovery URL fails or not set

    Returns:
        JWKS dictionary with keys
    """
    # Get JWKS URI from well-known configuration if not cached
    if not self.jwks_uri:
      discovery_attempts = []
      oidc_config = None

      # Attempt 1: Try explicit discovery URL if provided
      if self.discovery_url:
        try:
          logger.debug(f"Provider '{self.name}': Attempting discovery with explicit URL: {self.discovery_url}")
          oidc_config = await self._fetch_oidc_config(self.discovery_url)
        except Exception as e:
          logger.warning(f"Provider '{self.name}': Explicit discovery URL failed: {e}")
          discovery_attempts.append(f"Discovery URL: {e}")

      # Attempt 2: Construct from issuer if config not yet obtained
      if not oidc_config and self.issuer:
        try:
          constructed_url = f"{self.issuer}/.well-known/openid-configuration"
          logger.debug(f"Provider '{self.name}': Attempting discovery from issuer: {constructed_url}")
          oidc_config = await self._fetch_oidc_config(constructed_url)
        except Exception as e:
          logger.warning(f"Provider '{self.name}': Discovery from issuer failed: {e}")
          discovery_attempts.append(f"Constructed from issuer: {e}")

      if not oidc_config:
        error_msg = "All OIDC discovery attempts failed: " + "; ".join(discovery_attempts)
        raise ValueError(error_msg)

      # Extract issuer from discovery if not explicitly set and available
      if not self.issuer and oidc_config.get("issuer"):
        self.issuer = oidc_config.get("issuer")
        logger.info(f"OIDC provider '{self.name}': Extracted issuer from discovery: {self.issuer}")

      self.jwks_uri = oidc_config.get("jwks_uri")

      if not self.jwks_uri:
        raise ValueError(f"JWKS URI not found in OIDC configuration for {self.issuer}")

      logger.info(f"OIDC provider '{self.name}' JWKS URI: {self.jwks_uri}")

    # Fetch JWKS
    logger.debug(f"Fetching JWKS from {self.jwks_uri}")
    async with httpx.AsyncClient(follow_redirects=True) as client:
      response = await client.get(self.jwks_uri, timeout=10.0)
      response.raise_for_status()
      return response.json()

  async def _fetch_oidc_config(self, well_known_url: str) -> Dict[str, Any]:
    """
    Fetch OIDC configuration from discovery endpoint.

    Args:
        well_known_url: Discovery endpoint URL

    Returns:
        OIDC configuration dictionary

    Raises:
        Exception if fetch fails
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
      response = await client.get(well_known_url, timeout=10.0)
      response.raise_for_status()
      return response.json()

  async def get_jwks(self) -> Dict[str, Any]:
    """
    Get JWKS with caching.

    Returns:
        Cached or fresh JWKS
    """
    now = time.time()

    # Return cached JWKS if still valid
    if self.jwks_cache and (now - self.jwks_cache_time) < self.jwks_cache_ttl:
      logger.debug(f"Using cached JWKS for provider '{self.name}'")
      return self.jwks_cache

    # Fetch fresh JWKS
    logger.debug(f"Fetching fresh JWKS for provider '{self.name}'")
    self.jwks_cache = await self._fetch_jwks()
    self.jwks_cache_time = now

    return self.jwks_cache

  async def validate_token(self, token: str) -> Dict[str, Any]:
    """
    Validate JWT token against this provider.

    Args:
        token: JWT token string

    Returns:
        Decoded token claims

    Raises:
        JWTError: If token is invalid
    """
    try:
      # Get JWKS
      jwks = await self.get_jwks()

      # Decode token header to get key ID (kid)
      unverified_header = jwt.get_unverified_header(token)
      kid = unverified_header.get("kid")

      if not kid:
        raise JWTError("Token missing 'kid' (key ID) in header")

      # Find matching key in JWKS
      key_dict = None
      for key in jwks.get("keys", []):
        if key.get("kid") == kid:
          key_dict = key
          break

      if not key_dict:
        raise JWTError(f"Key ID '{kid}' not found in JWKS")

      # Validate and decode token
      # Supported algorithms: RSA (RS*) and ECDSA (ES*) - covers most OIDC providers
      claims = jwt.decode(
        token,
        key_dict,
        algorithms=["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
        audience=self.audience,
        issuer=self.issuer,
        options={
          "verify_signature": True,
          "verify_exp": True,
          "verify_nbf": True,
          "verify_iat": True,
          "verify_aud": True,
          "verify_iss": True,
        },
      )

      logger.debug(f"Token validated successfully for provider '{self.name}'")
      return claims

    except JWTError as e:
      logger.debug(f"Token validation failed for provider '{self.name}': {e}")
      raise

  async def fetch_userinfo(self, access_token: str) -> Dict[str, Any]:
    """
    Fetch user claims from OIDC provider's userinfo endpoint.

    This is the standards-compliant way to get user claims (email, groups, etc.)
    using the access token. The userinfo endpoint returns authoritative claims
    from the identity provider.

    Args:
        access_token: Valid OAuth2 access token

    Returns:
        User claims dictionary (email, groups, members, etc.)

    Raises:
        Exception: If userinfo fetch fails
    """
    # Get userinfo endpoint from discovery if not cached
    if not hasattr(self, "_userinfo_endpoint") or not self._userinfo_endpoint:
      # Fetch OIDC discovery to get userinfo endpoint
      discovery_url = self.discovery_url or f"{self.issuer}/.well-known/openid-configuration"
      try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
          response = await client.get(discovery_url, timeout=10.0)
          response.raise_for_status()
          config = response.json()
          self._userinfo_endpoint = config.get("userinfo_endpoint")
          if not self._userinfo_endpoint:
            raise ValueError(f"No userinfo_endpoint found in OIDC discovery for {self.name}")
          logger.info(f"OIDC provider '{self.name}' userinfo endpoint: {self._userinfo_endpoint}")
      except Exception as e:
        logger.error(f"Failed to discover userinfo endpoint for provider '{self.name}': {e}")
        raise

    # Fetch userinfo using access token
    try:
      async with httpx.AsyncClient(follow_redirects=True) as client:
        response = await client.get(self._userinfo_endpoint, headers={"Authorization": f"Bearer {access_token}"}, timeout=10.0)
        response.raise_for_status()
        userinfo = response.json()
        logger.debug(f"Fetched userinfo for provider '{self.name}': keys={list(userinfo.keys())}")
        return userinfo
    except httpx.HTTPStatusError as e:
      logger.error(f"Userinfo fetch failed for provider '{self.name}': HTTP {e.response.status_code}")
      raise
    except Exception as e:
      logger.error(f"Userinfo fetch failed for provider '{self.name}': {e}")
      raise

  async def validate_id_token(self, token: str) -> Dict[str, Any]:
    """
    Validate ID token with relaxed checks (signature and expiry only).

    ID tokens are used for identity claims extraction (email, groups), not authorization.
    We validate the signature to ensure authenticity but skip audience/issuer
    checks since ID tokens have different semantics than access tokens.

    Note: This method is deprecated in favor of fetch_userinfo() which is the
    standards-compliant way to get user claims. Kept for backward compatibility.

    Args:
        token: JWT ID token string

    Returns:
        Decoded token claims

    Raises:
        JWTError: If token signature is invalid or token is expired
    """
    try:
      # Get JWKS
      jwks = await self.get_jwks()

      # Decode token header to get key ID (kid)
      unverified_header = jwt.get_unverified_header(token)
      kid = unverified_header.get("kid")

      if not kid:
        raise JWTError("ID token missing 'kid' (key ID) in header")

      # Find matching key in JWKS
      key_dict = None
      for key in jwks.get("keys", []):
        if key.get("kid") == kid:
          key_dict = key
          break

      if not key_dict:
        raise JWTError(f"Key ID '{kid}' not found in JWKS for ID token")

      # Validate signature and expiry only (skip audience/issuer)
      # Supported algorithms: RSA (RS*) and ECDSA (ES*) - covers most OIDC providers
      claims = jwt.decode(
        token,
        key_dict,
        algorithms=["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
        options={
          "verify_signature": True,
          "verify_exp": True,
          "verify_nbf": True,
          "verify_iat": True,
          "verify_aud": False,  # Skip - ID tokens have different audience semantics
          "verify_iss": False,  # Skip - we already validated access token issuer
        },
      )

      logger.debug(f"ID token validated successfully for provider '{self.name}'")
      return claims

    except JWTError as e:
      logger.debug(f"ID token validation failed for provider '{self.name}': {e}")
      raise


class AuthManager:
  """Manages multiple OIDC providers and token validation."""

  def __init__(self):
    """Initialize auth manager and load OIDC providers from environment."""
    self.providers: Dict[str, OIDCProvider] = {}
    self._load_providers()

  def _load_providers(self):
    """Load OIDC provider configurations from environment variables."""
    # Load UI provider
    ui_issuer = os.getenv("OIDC_ISSUER")
    ui_client_id = os.getenv("OIDC_CLIENT_ID")
    ui_discovery_url = os.getenv("OIDC_DISCOVERY_URL")

    # Require either issuer or discovery URL, plus client_id
    if (ui_issuer or ui_discovery_url) and ui_client_id:
      self.providers["ui"] = OIDCProvider(
        issuer=ui_issuer.rstrip("/") if ui_issuer else "",  # Empty string if only discovery URL
        audience=ui_client_id,
        name="ui",
        discovery_url=ui_discovery_url,
      )
      logger.info("UI OIDC provider configured")
    else:
      logger.warning("UI OIDC provider not configured (need OIDC_CLIENT_ID and either OIDC_ISSUER or OIDC_DISCOVERY_URL)")

    # Load Ingestor provider
    ingestor_issuer = os.getenv("INGESTOR_OIDC_ISSUER")
    ingestor_client_id = os.getenv("INGESTOR_OIDC_CLIENT_ID")
    ingestor_discovery_url = os.getenv("INGESTOR_OIDC_DISCOVERY_URL")

    # Require either issuer or discovery URL, plus client_id
    if (ingestor_issuer or ingestor_discovery_url) and ingestor_client_id:
      self.providers["ingestor"] = OIDCProvider(
        issuer=ingestor_issuer.rstrip("/") if ingestor_issuer else "",  # Empty string if only discovery URL
        audience=ingestor_client_id,
        name="ingestor",
        discovery_url=ingestor_discovery_url,
      )
      logger.info("Ingestor OIDC provider configured")
    else:
      logger.info("Ingestor OIDC provider not configured (using trusted network or UI-only auth)")

    if not self.providers:
      logger.warning("No OIDC providers configured! Either configure OIDC providers or enable trusted network access (ALLOW_TRUSTED_NETWORK=true)")

  async def validate_token(self, token: str) -> Tuple[OIDCProvider, Dict[str, Any]]:
    """
    Validate token against all configured providers.

    Tries each provider in sequence until one succeeds.

    Args:
        token: JWT token string

    Returns:
        Tuple of (provider, claims) for the first successful validation

    Raises:
        JWTError: If token is invalid for all providers
    """
    if not self.providers:
      raise JWTError("No OIDC providers configured for token validation")

    errors = []

    for provider in self.providers.values():
      try:
        claims = await provider.validate_token(token)
        logger.info(f"Token validated successfully by provider '{provider.name}'")
        return provider, claims
      except JWTError as e:
        errors.append(f"{provider.name}: {str(e)}")
        continue

    # All providers failed
    error_msg = f"Token validation failed for all providers: {'; '.join(errors)}"
    logger.warning(error_msg)
    raise JWTError(error_msg)

  async def validate_id_token(self, token: str, provider: OIDCProvider) -> Dict[str, Any]:
    """
    Validate ID token using the specified provider.

    The ID token should be validated using the same provider that validated
    the access token, to ensure consistent key material.

    Note: This method is deprecated in favor of fetch_userinfo() which is the
    standards-compliant way to get user claims.

    Args:
        token: JWT ID token string
        provider: The OIDC provider that validated the access token

    Returns:
        Decoded ID token claims

    Raises:
        JWTError: If ID token is invalid
    """
    return await provider.validate_id_token(token)

  async def fetch_userinfo(self, access_token: str, provider: OIDCProvider) -> Dict[str, Any]:
    """
    Fetch user claims from OIDC provider's userinfo endpoint.

    This is the standards-compliant way to get user claims (email, groups, etc.)
    using the access token.

    Args:
        access_token: Valid OAuth2 access token
        provider: The OIDC provider that validated the access token

    Returns:
        User claims dictionary (email, groups, members, etc.)

    Raises:
        Exception: If userinfo fetch fails
    """
    return await provider.fetch_userinfo(access_token)


# Global auth manager instance (initialized on first use)
_auth_manager: Optional[AuthManager] = None


@lru_cache(maxsize=1)
def get_auth_manager() -> AuthManager:
  """
  Get or create the global auth manager instance.

  Uses lru_cache to ensure singleton pattern.

  Returns:
      AuthManager instance
  """
  global _auth_manager
  if _auth_manager is None:
    _auth_manager = AuthManager()
  return _auth_manager
