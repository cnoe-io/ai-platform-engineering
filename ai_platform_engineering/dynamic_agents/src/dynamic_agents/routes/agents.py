"""Agent inspection endpoints for the Dynamic Agents service.

The autonomous-agents service uses this narrow probe to verify that a
configured ``dynamic_agent_id`` exists before scheduling runs. The
response intentionally returns only basic metadata.

This module is deliberately read-only: full agent CRUD (create / update /
delete / list) lives in the Next.js BFF gateway, matching upstream's
re-architecture (`services/mongo.py` is a pure read-only runtime reader).
Do not add write endpoints here without also adding the corresponding
methods to ``MongoDBService`` — see commit 690938be for original intent.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from dynamic_agents.auth.auth import get_user_context
from dynamic_agents.models import UserContext
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("/{agent_id}/probe")
async def probe_agent(
    agent_id: str,
    _user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Return basic metadata for one dynamic agent."""
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    return {
        "id": agent.id,
        "name": agent.name,
        "enabled": getattr(agent, "enabled", True),
    }
