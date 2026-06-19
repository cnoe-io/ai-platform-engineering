"""Read + reachability endpoints for Dynamic Agent configurations.

Agent create/update/delete is owned by the UI BFF (it writes the
``dynamic_agents`` Mongo collection directly); this service is read-only
over agent configs. Two endpoints are exposed:

* ``GET /agents/{agent_id}`` -- fetch a single config (visibility-checked).
* ``GET /agents/{agent_id}/probe`` -- a thin reachability probe used by the
  autonomous-agents service to verify that a configured ``dynamic_agent_id``
  actually points at a real agent before it schedules executions through it.
  The probe is intentionally tiny -- it returns just enough metadata for the
  autonomous-agents UI to render an "Ack OK" badge with the agent's display
  name, and nothing else (no system prompts, tool allowlists, or other
  internals that could leak to a less-privileged service-to-service caller).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from dynamic_agents.auth.access import can_view_agent
from dynamic_agents.auth.auth import (
    UserContext,
    get_current_user,
    get_user_context,
)
from dynamic_agents.models import ApiResponse
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("/{agent_id}", response_model=ApiResponse)
async def get_agent(
    agent_id: str,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    """Get a dynamic agent configuration by ID."""
    agent = mongo.get_agent(agent_id)

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Check visibility
    if not can_view_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    return ApiResponse(
        success=True,
        data=agent.model_dump(by_alias=True),
    )


@router.get("/{agent_id}/probe")
async def probe_agent(
    agent_id: str,
    _user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Reachability probe for a single dynamic agent.

    Returns the agent's id, display name, and ``enabled`` flag so the
    autonomous-agents preflight can render a meaningful Ack badge
    without needing to pull the full agent config.

    Returns 404 when the id is not found rather than mapping it to a
    generic "ok / not ok" payload -- the caller already special-cases
    404 to render an actionable "agent was deleted" message.

    Trust model: identical to every other route in this service -- the
    ``X-User-Context`` header is gateway-trusted via ``get_user_context``.
    For probes coming from autonomous-agents the gateway is the
    autonomous-agents service itself, which mints a synthetic system
    identity (see ``autonomous_agents.services.dynamic_agents_client``).
    """
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    return {
        "id": agent.id,
        "name": agent.name,
        "enabled": getattr(agent, "enabled", True),
    }
