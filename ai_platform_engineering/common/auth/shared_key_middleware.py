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

# Load environment variables from .env file
load_dotenv()

logger = logging.getLogger(__name__)

USE_SHARED_KEY = os.getenv('USE_SHARED_KEY', 'false').lower() == 'true'

if USE_SHARED_KEY:
  SHARED_KEY = os.environ["SHARED_KEY"]
  if not SHARED_KEY:
    raise ValueError('SHARED_KEY is not set')

class SharedKeyMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that authenticates A2A access using a shared key."""

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
        Middleware to authenticate requests using a shared key.
        :param request:
        :param call_next:
        :return:
        """
        path = request.url.path
        for header_name, header_value in request.headers.items():
            if header_name.lower() == 'authorization':
                # Mask the Authorization header for security
                if header_value.startswith('SharedKey '):
                    token = header_value[10:]  # Remove 'SharedKey ' prefix
                    masked_token = f"{token[:3]}{'*' * (min(len(token), 10) - 3)}" if len(token) >= 4 else "***"
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
            if access_token != SHARED_KEY:
                logger.warning('Invalid shared key: %s', access_token)
                return self._unauthorized(
                    'Invalid shared key.', request
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