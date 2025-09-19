import json
import logging
import os
import jwt
from jwt import InvalidTokenError
from dotenv import load_dotenv
from a2a.types import AgentCard
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse
try:
    # Try absolute import (when run directly)
    from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.jwks_cache import JwksCache
except ImportError:
    # Fall back to relative import (when run as module)
    from .jwks_cache import JwksCache

# Load environment variables from .env file
load_dotenv()

logger = logging.getLogger(__name__)

USE_OAUTH2 = os.getenv('USE_OAUTH2', 'false').lower() == 'true'

if USE_OAUTH2:
  CLOCK_SKEW_LEEWAY = 10
  ALGORITHMS = ["RS256"]
  JWKS_URI = os.environ["JWKS_URI"]
  AUDIENCE = os.environ["AUDIENCE"]  # expected 'aud' claim in token
  ISSUER = os.environ["ISSUER"]
  CIRCUIT_CLIENT_ID = os.environ["OAUTH2_CLIENT_ID"]  # your client ID for audience validation
  DEBUG_UNMASK_AUTH_HEADER = os.environ.get("DEBUG_UNMASK_AUTH_HEADER", "false").lower() == "true"
  _jwks_cache = JwksCache(JWKS_URI)

  print("\n" + "="*40)
  print(f"JWKS_URI: {JWKS_URI}")
  print("="*40 + "\n")



# ------------------------------------------------------------------------------
# Public key builder from JWK (supports RSA and EC)
# ------------------------------------------------------------------------------
def _public_key_from_jwk(jwk: dict):
    """
    Build a public key object from a JWK. Supports RSA and EC.
    """
    kty = jwk.get("kty")
    if kty == "RSA":
        return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))

    if kty == "EC":
        return jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(jwk))
    raise ValueError(f"Unsupported key type: {kty}")


# ------------------------------------------------------------------------------
# Token verification
# ------------------------------------------------------------------------------
def verify_token(token: str) -> bool:
    """
    Local JWT validation with JWKS. Returns True if token is valid and intended for this agent.
    - Verifies signature.
    - Checks iss, aud, exp, nbf.
    """
    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError:
        logger.warning("Invalid token header")
        return False

    kid = header.get("kid")
    if not kid:
        logger.warning("Missing kid in token header")
        return False

    jwk = _jwks_cache.get_jwk(kid)
    if not jwk:
        logger.warning("Unknown signing key (kid=%s)", kid)
        return False

    try:
        public_key = _public_key_from_jwk(jwk)
        # aud and exp validation happen inside jwt.decode:
        # - audience=AUDIENCE sets expected aud (aud claim must match).
        # - options.verify_exp=True enforces exp claim (not expired).
        # - options.verify_aud=True enables the aud check.
        payload = jwt.decode(
            token,
            public_key,
            algorithms=ALGORITHMS,
            audience=AUDIENCE,           # aud validated against this value
            issuer=ISSUER,               # iss must match this value
            options={
                "require": ["exp", "iss", "aud"],
                "verify_signature": True,
                "verify_exp": True,      # exp validation enabled
                "verify_nbf": True,      # nbf validation enabled
                "verify_iss": True,      # iss validation enabled
                "verify_aud": True,      # aud validation enabled
            },
            leeway=CLOCK_SKEW_LEEWAY,    # small clock skew tolerance (seconds)
        )
        # Check if 'cid' claim exists and validate it
        if "cid" in payload:
            token_cid = payload["cid"]
            if token_cid == CIRCUIT_CLIENT_ID:
                logger.debug(f"Token CID matches expected client ID: {token_cid}")
                return True
            else:
                logger.warning(f"Token CID '{token_cid}' does not match expected client ID '{CIRCUIT_CLIENT_ID}'")
                return False
        else:
            print("\n" + "="*40)
            print("Token missing 'cid' claim. Moving on and return True")
            print("="*40 + "\n")
    except InvalidTokenError as e:
        logger.warning("Token validation failed: %s", e)
        return False
    except Exception as e:
        logger.warning("Token verification error: %s", e)
        return False
    return True

class OAuth2Middleware(BaseHTTPMiddleware):
    """Starlette middleware that authenticates A2A access using an OAuth2 bearer token."""

    def __init__(
        self,
        app: Starlette,
        agent_card: AgentCard = None,
        public_paths: list[str] = None,
    ):
        super().__init__(app)
        self.agent_card = agent_card
        self.public_paths = set(public_paths or [])

    async def dispatch(self, request: Request, call_next):
        """
        Middleware to authenticate requests using OAuth2 bearer tokens.
        :param request:
        :param call_next:
        :return:
        """
        path = request.url.path
        for header_name, header_value in request.headers.items():
            if header_name.lower() == 'authorization' and not DEBUG_UNMASK_AUTH_HEADER:
                # Mask the Authorization header for security
                if header_value.startswith('Bearer '):
                    token = header_value[7:]  # Remove 'Bearer ' prefix
                    masked_token = f"{token[:10]}.........{token[-10:]}" if len(token) > 20 else "***"
                    print(f"{header_name}: Bearer {masked_token}")
                else:
                    print(f"{header_name}: ***MASKED***")
            else:
                print(f"{header_name}: {header_value}")


        # Allow public paths and anonymous access
        if path in self.public_paths:
            return await call_next(request)

        # Authenticate the request
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            logger.warning('Missing or malformed Authorization header: %s', auth_header)
            return self._unauthorized(
                'Missing or malformed Authorization header.', request
            )

        access_token = auth_header.split('Bearer ')[1]

        try:

            is_valid = verify_token(access_token)
            if not is_valid:
                logger.warning(f'Invalid or expired access token : {auth_header}',)
                return self._unauthorized(
                    'Invalid or expired access token.', request
                )
        except Exception as e:
            logger.error('Dispatch error: %s', e, exc_info=True)
            return self._forbidden(f'Authentication failed: {e}', request)

        return await call_next(request)

    def _forbidden(self, reason: str, request: Request):
        """
        Returns a 403 Forbidden response with a reason.
        :param reason:
        :param request:
        :return:
        """
        accept_header = request.headers.get('accept', '')
        if 'text/event-stream' in accept_header:
            return PlainTextResponse(
                f'error forbidden: {reason}',
                status_code=403,
                media_type='text/event-stream',
            )
        return JSONResponse(
            {'error': 'forbidden', 'reason': reason}, status_code=403
        )

    def _unauthorized(self, reason: str, request: Request):
        """
        Returns a 401 Unauthorized response with a reason.
        :param reason:
        :param request:
        :return:
        """
        accept_header = request.headers.get('accept', '')
        if 'text/event-stream' in accept_header:
            return PlainTextResponse(
                f'error unauthorized: {reason}',
                status_code=401,
                media_type='text/event-stream',
            )
        return JSONResponse(
            {'error': 'unauthorized', 'reason': reason}, status_code=401
        )
