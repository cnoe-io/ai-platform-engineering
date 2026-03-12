"""LLM models discovery endpoint.

Returns available LLM models that can be selected when creating
or editing dynamic agents.
"""

from fastapi import APIRouter, Depends

from dynamic_agents.middleware.auth import UserContext, get_current_user
from dynamic_agents.models import ApiResponse
from dynamic_agents.services.models_config import get_available_models

router = APIRouter(prefix="/llm-models", tags=["llm-models"])


@router.get("", response_model=ApiResponse)
async def list_available_models(
    _user: UserContext = Depends(get_current_user),
) -> ApiResponse:
    """List available LLM models for agent configuration.

    Returns a list of models that can be selected when creating or editing
    a dynamic agent. The list is loaded from a YAML configuration file
    that can be mounted as a ConfigMap in Kubernetes.
    """
    models = get_available_models()
    return ApiResponse(
        success=True,
        data=[
            {
                "model_id": m.model_id,
                "name": m.name,
                "provider": m.provider,
                "description": m.description,
            }
            for m in models
        ],
    )
