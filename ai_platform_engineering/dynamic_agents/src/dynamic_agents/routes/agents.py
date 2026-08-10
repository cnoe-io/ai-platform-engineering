"""Authenticated agent helper endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from dynamic_agents.auth.auth import get_user_context
from dynamic_agents.auth.authz import require_agent_use_permission
from dynamic_agents.config import get_settings
from dynamic_agents.models import UserContext
from dynamic_agents.services.memory_namespaces import resolve_memory_namespaces
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("/{agent_id}/memory-namespaces")
async def get_memory_namespaces(
    agent_id: str,
    refresh: bool = Query(False),
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Resolve memory working contexts using the caller's bearer token."""

    await require_agent_use_permission(agent_id)
    agent = mongo.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    try:
        items = await resolve_memory_namespaces(
            agent,
            mongo.get_agent_mcp_servers(agent),
            get_settings(),
            use_cache=not refresh,
        )
    except Exception as exc:  # noqa: BLE001 - picker failure must not block unscoped chat
        logger.warning("Could not resolve memory namespaces for %s: %s", agent_id, exc)
        raise HTTPException(status_code=503, detail="Memory namespaces are temporarily unavailable") from exc
    memory = agent.builtin_tools.memory if agent.builtin_tools else None
    return {
        "success": True,
        "data": {"items": items, "allow_custom": bool(memory and memory.allow_custom)},
    }
