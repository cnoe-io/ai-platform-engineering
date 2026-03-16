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
    from ai_platform_engineering.utils.auth.jwks_cache import JwksCache
except ImportError:
    from .jwks_cache import JwksCache

from ai_platform_engineering.utils.auth.user_context import (
    verified_user_var,
    build_user_context_from_token,
)

load_dotenv()

logger = logging.getLogger(__name__)

A2A_AUTH_OAUTH2 = os.getenv('A2A_AUTH_OAUTH2', 'false').lower() == 'true'

if A2A_AUTH_OAUTH2:
  CLOCK_SKEW_LEEWAY = 10
  ALGORITHMS = os.environ.get("ALLOWED_ALGORITHMS", "RS256,ES256").split(",")
  JWKS_URI = os.environ["JWKS_URI"]
  AUDIENCE = os.environ["AUDIENCE"]
  ISSUER = os.environ["ISSUER"]
  OAUTH2_CLIENT_IDS = {cid.strip() for cid in os.environ["OAUTH2_CLIENT_ID"].split(",") if cid.strip()}
  DEBUG_UNMASK_AUTH_HEADER = os.environ.get("DEBUG_UNMASK_AUTH_HEADER", "false").lower() == "true"
  _jwks_cache = JwksCache(JWKS_URI)

  print("\n" + "="*40)
  print(f"JWKS_URI: {JWKS_URI}")
  print(f"ALLOWED_ALGORITHMS: {ALGORITHMS}")
  print("="*40 + "\n")


def _public_key_from_jwk(jwk: dict):
    """Build a public key object from a JWK. Supports RSA and EC."""
    kty = jwk.get("kty")
    if kty == "RSA":
        return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))

    if kty == "EC":
        return jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(jwk))
    raise ValueError(f"Unsupported key type: {kty}")


def verify_token(token: str) -> dict | None:
    """Validate JWT and return the decoded claims payload, or None on failure.

    Verifies signature, iss, aud, exp, nbf. Optionally validates the
    ``cid`` claim against ``OAUTH2_CLIENT_IDS``.
    """
    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError as e:
        logger.warning("Invalid token header: %s", e)
        return None
    except Exception as e:
        logger.warning("Unexpected error parsing token header: %s", e)
        return None

    kid = header.get("kid")
    if not kid:
        logger.warning("Missing kid in token header")
        return None

    jwk = _jwks_cache.get_jwk(kid)
    if not jwk:
        logger.warning("Unknown signing key (kid=%s)", kid)
        return None

    try:
        public_key = _public_key_from_jwk(jwk)
        payload = jwt.decode(
            token,
            public_key,
            algorithms=ALGORITHMS,
            audience=AUDIENCE,
            issuer=ISSUER,
            options={
                "require": ["exp", "iss", "aud"],
                "verify_signature": True,
                "verify_exp": True,
                "verify_nbf": True,
                "verify_iss": True,
                "verify_aud": True,
            },
            leeway=CLOCK_SKEW_LEEWAY,
        )
        if "cid" in payload:
            token_cid = payload["cid"]
            if token_cid in OAUTH2_CLIENT_IDS:
                logger.debug("Token CID matches allowed client ID: %s", token_cid)
                return payload
            else:
                logger.warning("Token CID '%s' not in allowed client IDs %s", token_cid, OAUTH2_CLIENT_IDS)
                return None
        else:
            logger.debug("Token missing 'cid' claim; proceeding without CID validation")
        return payload
    except InvalidTokenError as e:
        logger.warning("Token validation failed: %s", e)
        return None
    except Exception as e:
        logger.warning("Token verification error: %s", e)
        return None


class OAuth2Middleware(BaseHTTPMiddleware):
    """Starlette middleware that authenticates A2A requests via OAuth2 bearer token.

    After successful JWT validation the middleware:
    1. Builds a ``UserContext`` (email from JWT claims, groups from the
       OIDC ``/userinfo`` endpoint, role resolved from OIDC admin group).
    2. Stores it in ``verified_user_var`` (a ``contextvars.ContextVar``)
       so downstream code (the A2A executor) can read verified identity
       without relying on client-controlled message body text.
    """

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
        path = request.url.path

        if request.method == "OPTIONS":
            return await call_next(request)

        for header_name, header_value in request.headers.items():
            if header_name.lower() == 'authorization' and not DEBUG_UNMASK_AUTH_HEADER:
                if header_value.startswith('Bearer '):
                    token = header_value[7:]
                    masked_token = f"{token[:3]}***{token[-3:]}" if len(token) > 20 else "***"
                    print(f"{header_name}: Bearer {masked_token}")
                else:
                    print(f"{header_name}: ***MASKED***")
            else:
                print(f"{header_name}: {header_value}")

        if path in self.public_paths:
            return await call_next(request)

        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            logger.warning('Missing or malformed Authorization header')
            return self._unauthorized(
                'Missing or malformed Authorization header.', request
            )

        access_token = auth_header.split('Bearer ')[1]

        try:
            claims = verify_token(access_token)
            if claims is None:
                logger.warning('Invalid or expired access token')
                return self._unauthorized(
                    'Invalid or expired access token.', request
                )
        except Exception as e:
            logger.error('Dispatch error: %s', e, exc_info=True)
            return self._forbidden(f'Authentication failed: {e}', request)

        # Build verified identity from JWT claims + /userinfo groups
        token_for_ctx = verified_user_var.set(None)
        try:
            user_context = await build_user_context_from_token(access_token, claims)
            verified_user_var.set(user_context)
            logger.info(
                "Verified user: email=%s, role=%s",
                user_context.email, user_context.role,
            )
        except Exception as e:
            logger.warning(
                "Failed to build user context (proceeding without role): %s", e
            )

        try:
            response = await call_next(request)
        finally:
            verified_user_var.reset(token_for_ctx)

        return response

    def _forbidden(self, reason: str, request: Request):
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
