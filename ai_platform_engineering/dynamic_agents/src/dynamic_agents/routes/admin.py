"""Admin endpoints for Dynamic Agents service.

These endpoints are called server-to-server by the Next.js UI backend,
not by end users. They are authenticated via DYNAMIC_AGENTS_SERVICE_TOKEN.
"""

import hmac
import logging

from fastapi import APIRouter, HTTPException, Request

from dynamic_agents.config import get_settings
from dynamic_agents.services.agent_runtime import get_runtime_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_service_token(request: Request) -> None:
    """Verify the request carries the DYNAMIC_AGENTS_SERVICE_TOKEN.

    Raises HTTP 401 if the token is missing or doesn't match.
    Raises HTTP 503 if the service token is not configured.

    Uses hmac.compare_digest for constant-time comparison to prevent
    timing attacks on the service token.
    """
    settings = get_settings()
    expected = settings.dynamic_agents_service_token
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="DYNAMIC_AGENTS_SERVICE_TOKEN is not configured on this service.",
        )
    auth = request.headers.get("Authorization", "")
    prefix = "Bearer "
    if not auth.startswith(prefix):
        raise HTTPException(status_code=401, detail="Unauthorized")
    provided = auth[len(prefix):].strip()
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.post("/refresh-credentials")
async def refresh_credentials(request: Request) -> dict:
    """Re-fetch LLM provider credentials from the UI and hot-reload them.

    Called by the Next.js UI backend immediately after an admin saves new
    LLM provider credentials. This avoids requiring a pod restart for
    credential rotations.

    - Re-fetches all provider configs from the UI env-export endpoint.
    - Updates os.environ for any keys previously injected from the DB
      (IaC-set env vars are never overridden).
    - Clears the agent runtime cache so the next request uses fresh
      credentials.

    Authentication: Bearer <DYNAMIC_AGENTS_SERVICE_TOKEN>
    """
    _require_service_token(request)

    # Import here to avoid a circular import at module load time.
    # _inject_llm_provider_env_vars and _db_injected_keys live in main
    # to keep them close to the startup injection logic they extend.
    from dynamic_agents.main import _inject_llm_provider_env_vars

    changed = _inject_llm_provider_env_vars(allow_refresh=True)

    if changed:
        cache = get_runtime_cache()
        await cache.clear()
        logger.info("[admin] Credential refresh: env updated and runtime cache cleared")
    else:
        logger.info("[admin] Credential refresh: no changes detected")

    return {"refreshed": changed}
