"""CRUD endpoints for Dynamic Agent configurations."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from dynamic_agents.middleware.auth import UserContext, get_current_user, require_admin
from dynamic_agents.models import (
    ApiResponse,
    DynamicAgentConfig,
    DynamicAgentConfigCreate,
    DynamicAgentConfigUpdate,
    PaginatedResponse,
    VisibilityType,
)
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=PaginatedResponse)
async def list_agents(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> PaginatedResponse:
    """List dynamic agents visible to the current user.

    Returns:
        - Global agents (visibility=global)
        - Team agents where user is a member (visibility=team)
        - User's own agents (visibility=private)
        - Admins see all agents
    """
    # Use the service method to list agents
    agents = mongo.list_agents(
        user_id=user.email,
        user_teams=user.groups,
        include_disabled=user.is_admin,
        admin_view=user.is_admin,
    )

    # Apply pagination
    total = len(agents)
    total_pages = (total + limit - 1) // limit if total > 0 else 1
    start = (page - 1) * limit
    end = start + limit
    paginated = agents[start:end]

    return PaginatedResponse(
        items=[a.model_dump(by_alias=True) for a in paginated],
        total=total,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


@router.post("", response_model=ApiResponse)
async def create_agent(
    config: DynamicAgentConfigCreate,
    user: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    """Create a new dynamic agent configuration.

    Requires admin role.
    """
    agent = mongo.create_agent(config, owner_id=user.email)
    logger.info(f"Created dynamic agent '{config.name}' ({agent.id}) by {user.email}")

    return ApiResponse(
        success=True,
        data=agent.model_dump(by_alias=True),
    )


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
    if not _can_view_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    return ApiResponse(
        success=True,
        data=agent.model_dump(by_alias=True),
    )


@router.patch("/{agent_id}", response_model=ApiResponse)
async def update_agent(
    agent_id: str,
    update: DynamicAgentConfigUpdate,
    user: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    """Update a dynamic agent configuration.

    Requires admin role.
    """
    agent = mongo.get_agent(agent_id)

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    updated = mongo.update_agent(agent_id, update)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update agent")

    logger.info(f"Updated dynamic agent '{agent_id}' by {user.email}")

    return ApiResponse(
        success=True,
        data=updated.model_dump(by_alias=True),
    )


@router.delete("/{agent_id}", response_model=ApiResponse)
async def delete_agent(
    agent_id: str,
    user: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    """Delete a dynamic agent configuration.

    Requires admin role. System agents cannot be deleted.
    """
    agent = mongo.get_agent(agent_id)

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if agent.is_system:
        raise HTTPException(
            status_code=400,
            detail="System agents cannot be deleted",
        )

    deleted = mongo.delete_agent(agent_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Failed to delete agent")

    logger.info(f"Deleted dynamic agent '{agent_id}' by {user.email}")

    return ApiResponse(success=True, data={"deleted": agent_id})


def _can_view_agent(agent: DynamicAgentConfig, user: UserContext) -> bool:
    """Check if user can view the agent."""
    # Admin can see all
    if user.is_admin:
        return True

    # Owner can see their own
    if agent.owner_id == user.email:
        return True

    # Global is visible to all
    if agent.visibility == VisibilityType.GLOBAL:
        return True

    # Team visibility requires group membership
    if agent.visibility == VisibilityType.TEAM:
        if agent.shared_with_teams:
            return any(team in user.groups for team in agent.shared_with_teams)

    return False
