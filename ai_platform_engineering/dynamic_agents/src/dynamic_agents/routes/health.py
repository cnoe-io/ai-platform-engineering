"""Health check endpoints for Dynamic Agents service."""

import time

from fastapi import APIRouter, Depends

from dynamic_agents.config import Settings, get_settings
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def health_check(
    settings: Settings = Depends(get_settings),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Health check endpoint.

    Returns service health status and configuration info.
    """
    health_status = "healthy"
    health_details = {}

    # Check MongoDB connectivity
    if mongo._client is None:
        health_status = "unhealthy"
        health_details["mongodb"] = "Not connected"

    return {
        "status": health_status,
        "timestamp": int(time.time()),
        "details": health_details,
        "config": {
            "mongodb_database": settings.mongodb_database,
            "collections": {
                "dynamic_agents": settings.dynamic_agents_collection,
                "mcp_servers": settings.mcp_servers_collection,
            },
            "agent_runtime_ttl_seconds": settings.agent_runtime_ttl_seconds,
        },
    }


@router.get("/readyz")
async def readiness_check(
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Readiness check endpoint.

    Returns 200 if the service is ready to accept traffic.
    """
    # Check MongoDB connectivity
    if mongo._client is not None:
        return {"ready": True}
    else:
        return {"ready": False, "error": "MongoDB not connected"}
