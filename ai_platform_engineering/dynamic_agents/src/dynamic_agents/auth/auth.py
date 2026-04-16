"""Gateway-trusted authentication for Dynamic Agents.

All requests to DA are proxied through the Next.js gateway, which handles
OIDC authentication and session management.  The gateway injects a trusted
``X-User-Context`` header (base64-encoded JSON) containing pre-computed
authorization flags.

DA never validates JWTs or calls OIDC endpoints directly.
"""

import base64
import json
import logging

from fastapi import Depends, HTTPException, Request

from dynamic_agents.config import Settings, get_settings
from dynamic_agents.models import UserContext

logger = logging.getLogger(__name__)


# Default user for unauthenticated internal callers (e.g. Slack bot).
# Shared/global identity — not admin, no special group memberships.
_GATEWAY_DEFAULT_USER = UserContext(
    email="internal@caipe.local",
    name="Internal Service",
    is_admin=False,
)


async def get_user_context(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> UserContext:
    """Extract user context from the gateway's X-User-Context header.

    The Next.js API gateway authenticates the user (via session cookie or
    Bearer token) and injects a trusted ``X-User-Context`` header containing
    a base64-encoded JSON object.

    The decoded JSON is passed directly to ``UserContext``.  Only ``email``
    is required; all other fields (``name``, ``is_admin``, ``is_authorized``,
    ``can_view_admin``, etc.) are opaque and pass through via
    ``extra="allow"``.  This keeps the gateway in control of what
    authorization flags exist — DA doesn't need to know or care.

    Fallback behaviour:
    - If ``AUTH_ENABLED=false`` (dev mode): returns a dev admin user.
    - If the header is missing: returns a shared default service identity
      (``internal@caipe.local``, non-admin).  This covers internal callers
      like the Slack bot that don't carry user credentials.
    - If the header is present but malformed: returns 400.
    """
    if not settings.auth_enabled:
        logger.debug("Auth disabled (AUTH_ENABLED=false), returning dev user")
        return UserContext(
            email="dev@localhost",
            name="Dev User",
            is_admin=True,
        )

    header = request.headers.get("X-User-Context")
    if not header:
        logger.debug("No X-User-Context header — using default internal user")
        return _GATEWAY_DEFAULT_USER

    try:
        decoded = base64.b64decode(header)
        data = json.loads(decoded)
        return UserContext(**data)
    except Exception as e:
        logger.warning(f"Malformed X-User-Context header: {e}")
        raise HTTPException(
            status_code=400,
            detail="Malformed X-User-Context header",
        )
