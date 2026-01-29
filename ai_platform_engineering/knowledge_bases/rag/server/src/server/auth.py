"""
Authentication module for RAG server with JWT validation.

Supports multiple OIDC providers (UI and Ingestor) with JWKS-based validation.
"""
import os
import time
from typing import Dict, Any, List, Tuple, Optional
from functools import lru_cache
import httpx
from jose import jwt, JWTError
from jose.backends import RSAKey
from common import utils

logger = utils.get_logger(__name__)


class OIDCProvider:
    """Represents an OIDC provider configuration with JWKS caching."""
    
    def __init__(self, issuer: str, audience: str, name: str):
        """
        Initialize OIDC provider.
        
        Args:
            issuer: OIDC issuer URL (e.g., https://keycloak.example.com/realms/production)
            audience: Expected audience claim (typically client_id)
            name: Human-readable name for this provider (e.g., "ui", "ingestor")
        """
        self.issuer = issuer
        self.audience = audience
        self.name = name
        self.jwks_uri: Optional[str] = None
        self.jwks_cache: Dict[str, Any] = {}
        self.jwks_cache_time: float = 0
        self.jwks_cache_ttl: int = 3600  # Cache JWKS for 1 hour
        
        logger.info(f"Initialized OIDC provider '{name}': issuer={issuer}, audience={audience}")
    
    async def _fetch_jwks(self) -> Dict[str, Any]:
        """
        Fetch JWKS (JSON Web Key Set) from OIDC provider.
        
        Returns:
            JWKS dictionary with keys
        """
        # Get JWKS URI from well-known configuration if not cached
        if not self.jwks_uri:
            well_known_url = f"{self.issuer}/.well-known/openid-configuration"
            logger.debug(f"Fetching OIDC configuration from {well_known_url}")
            
            async with httpx.AsyncClient() as client:
                response = await client.get(well_known_url, timeout=10.0)
                response.raise_for_status()
                config = response.json()
                self.jwks_uri = config.get("jwks_uri")
                
                if not self.jwks_uri:
                    raise ValueError(f"JWKS URI not found in OIDC configuration for {self.issuer}")
                
                logger.info(f"OIDC provider '{self.name}' JWKS URI: {self.jwks_uri}")
        
        # Fetch JWKS
        logger.debug(f"Fetching JWKS from {self.jwks_uri}")
        async with httpx.AsyncClient() as client:
            response = await client.get(self.jwks_uri, timeout=10.0)
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
            claims = jwt.decode(
                token,
                key_dict,
                algorithms=["RS256", "RS384", "RS512"],
                audience=self.audience,
                issuer=self.issuer,
                options={
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_nbf": True,
                    "verify_iat": True,
                    "verify_aud": True,
                    "verify_iss": True,
                }
            )
            
            logger.debug(f"Token validated successfully for provider '{self.name}'")
            return claims
            
        except JWTError as e:
            logger.debug(f"Token validation failed for provider '{self.name}': {e}")
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
        
        if ui_issuer and ui_client_id:
            self.providers["ui"] = OIDCProvider(
                issuer=ui_issuer.rstrip("/"),  # Remove trailing slash
                audience=ui_client_id,
                name="ui"
            )
            logger.info("UI OIDC provider configured")
        else:
            logger.warning("UI OIDC provider not configured (OIDC_ISSUER or OIDC_CLIENT_ID missing)")
        
        # Load Ingestor provider
        ingestor_issuer = os.getenv("INGESTOR_OIDC_ISSUER")
        ingestor_client_id = os.getenv("INGESTOR_OIDC_CLIENT_ID")
        
        if ingestor_issuer and ingestor_client_id:
            self.providers["ingestor"] = OIDCProvider(
                issuer=ingestor_issuer.rstrip("/"),
                audience=ingestor_client_id,
                name="ingestor"
            )
            logger.info("Ingestor OIDC provider configured")
        else:
            logger.info("Ingestor OIDC provider not configured (using trusted network or UI-only auth)")
        
        if not self.providers:
            logger.warning(
                "No OIDC providers configured! Either configure OIDC providers or enable "
                "trusted network access (ALLOW_TRUSTED_NETWORK=true)"
            )
    
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
