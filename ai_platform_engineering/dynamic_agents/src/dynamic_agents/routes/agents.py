"""CRUD endpoints for Dynamic Agent configurations."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from dynamic_agents.auth.auth import UserContext, get_current_user, require_admin
from dynamic_agents.models import (
    ApiResponse,
    DynamicAgentConfig,
    DynamicAgentConfigCreate,
    DynamicAgentConfigUpdate,
    PaginatedResponse,
    SubAgentRef,
    VisibilityType,
)
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])


def validate_subagent_visibility(
    parent_visibility: VisibilityType,
    subagents: list[SubAgentRef],
    mongo: MongoDBService,
) -> tuple[bool, str | None]:
    """Validate that subagents have compatible visibility with parent.

    Rules:
    - Private agent → can use private, team, or global subagents
    - Team agent → can use team or global subagents
    - Global agent → can only use global subagents

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not subagents:
        return True, None

    for subagent_ref in subagents:
        subagent = mongo.get_agent(subagent_ref.agent_id)
        if not subagent:
            return False, f'Subagent "{subagent_ref.agent_id}" not found'

        sub_vis = subagent.visibility

        # Global parent can only use global subagents
        if parent_visibility == VisibilityType.GLOBAL and sub_vis != VisibilityType.GLOBAL:
            return (
                False,
                f'Global agents can only use global subagents. "{subagent.name}" is {sub_vis.value}.',
            )

        # Team parent can use team or global subagents
        if parent_visibility == VisibilityType.TEAM and sub_vis == VisibilityType.PRIVATE:
            return (
                False,
                f'Team agents can only use team or global subagents. "{subagent.name}" is private.',
            )

        # Private parent can use any visibility - no restrictions

    return True, None


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
    # Validate subagent visibility compatibility
    if config.subagents:
        is_valid, error = validate_subagent_visibility(
            config.visibility,
            config.subagents,
            mongo,
        )
        if not is_valid:
            raise HTTPException(status_code=400, detail=error)

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

    Requires admin role. Config-driven agents cannot be updated.
    """
    agent = mongo.get_agent(agent_id)

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Block updates to config-driven agents
    if agent.config_driven:
        raise HTTPException(
            status_code=403,
            detail="Config-driven agents cannot be modified. Update config.yaml instead.",
        )

    # Determine final values for visibility validation
    final_visibility = update.visibility if update.visibility is not None else agent.visibility
    final_subagents = update.subagents if update.subagents is not None else agent.subagents

    # Validate subagent visibility compatibility
    if final_subagents:
        is_valid, error = validate_subagent_visibility(
            final_visibility,
            final_subagents,
            mongo,
        )
        if not is_valid:
            raise HTTPException(status_code=400, detail=error)

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

    Requires admin role. System agents and config-driven agents cannot be deleted.
    """
    agent = mongo.get_agent(agent_id)

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if agent.is_system:
        raise HTTPException(
            status_code=400,
            detail="System agents cannot be deleted",
        )

    if agent.config_driven:
        raise HTTPException(
            status_code=403,
            detail="Config-driven agents cannot be deleted. Remove from config.yaml instead.",
        )

    deleted = mongo.delete_agent(agent_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Failed to delete agent")

    logger.info(f"Deleted dynamic agent '{agent_id}' by {user.email}")

    return ApiResponse(success=True, data={"deleted": agent_id})


@router.get("/{agent_id}/available-subagents", response_model=ApiResponse)
async def list_available_subagents(
    agent_id: str,
    user: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    """List agents that can be configured as subagents for the given agent.

    Returns all enabled agents except:
    - The agent itself (can't delegate to itself)
    - Agents that would create a circular reference

    Requires admin role.
    """
    # Get the parent agent
    parent_agent = mongo.get_agent(agent_id)
    if not parent_agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get all enabled agents
    all_agents = mongo.list_agents(
        user_id=user.email,
        user_teams=user.groups,
        include_disabled=False,
        admin_view=True,
    )

    # Find agents that would create a cycle
    ancestors = _get_ancestor_agent_ids(agent_id, mongo)

    # Filter out self and ancestors
    available = []
    for agent in all_agents:
        if agent.id == agent_id:
            continue  # Can't delegate to self
        if agent.id in ancestors:
            continue  # Would create a cycle
        available.append(
            {
                "id": agent.id,
                "name": agent.name,
                "description": agent.description,
                "visibility": agent.visibility.value,
            }
        )

    return ApiResponse(
        success=True,
        data={"agents": available},
    )


def _get_ancestor_agent_ids(agent_id: str, mongo: MongoDBService) -> set[str]:
    """Get all agent IDs that have this agent as a subagent (directly or indirectly).

    Used for cycle detection - we can't add an ancestor as a subagent because
    it would create A -> B -> A cycle.
    """
    ancestors: set[str] = set()

    # Get all agents and build a reverse lookup
    all_agents = mongo.list_agents(admin_view=True, include_disabled=True)

    # Build a map: child_id -> set of parent_ids
    child_to_parents: dict[str, set[str]] = {}
    for agent in all_agents:
        for subagent_ref in agent.subagents:
            if subagent_ref.agent_id not in child_to_parents:
                child_to_parents[subagent_ref.agent_id] = set()
            child_to_parents[subagent_ref.agent_id].add(agent.id)

    # BFS to find all ancestors
    queue = [agent_id]
    visited: set[str] = set()

    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)

        parents = child_to_parents.get(current, set())
        for parent_id in parents:
            ancestors.add(parent_id)
            queue.append(parent_id)

    return ancestors


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
