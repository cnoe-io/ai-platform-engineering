"""Middleware registry discovery endpoint.

Returns available middleware types and their configuration options,
allowing the UI to dynamically render the middleware picker without
hardcoding definitions.
"""

from fastapi import APIRouter

from dynamic_agents.services.middleware import get_middleware_definitions

router = APIRouter(prefix="/middleware", tags=["middleware"])


@router.get("")
async def list_middleware() -> dict:
    """List available middleware types with their configuration options.

    Returns middleware definitions including:
    - key: Middleware type identifier
    - label: Display name
    - description: What the middleware does
    - enabled_by_default: Whether enabled by default for new agents
    - allow_multiple: Whether multiple instances are allowed
    - default_params: Default parameter values
    - model_params: Whether this middleware needs model_id/model_provider
    - param_schema: Type hints for params ("number", "boolean", "opt1|opt2|...")

    No authentication required - this is static metadata.
    """
    definitions = get_middleware_definitions()
    return {
        "success": True,
        "data": {
            "middleware": definitions,
        },
    }
