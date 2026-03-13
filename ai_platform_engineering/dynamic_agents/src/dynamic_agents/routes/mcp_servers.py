"""CRUD endpoints for MCP Server configurations."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from dynamic_agents.middleware.auth import UserContext, require_admin
from dynamic_agents.models import (
    ApiResponse,
    MCPServerConfigCreate,
    MCPServerConfigUpdate,
    MCPServerProbeResult,
    PaginatedResponse,
    TransportType,
)
from dynamic_agents.services.mcp_client import probe_server_tools
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mcp-servers", tags=["mcp-servers"])


@router.get("", response_model=PaginatedResponse)
async def list_mcp_servers(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    user: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> PaginatedResponse:
    """List all MCP server configurations.

    Requires admin role.
    """
    servers = mongo.list_servers(include_disabled=True)

    # Apply pagination
    total = len(servers)
    total_pages = (total + limit - 1) // limit if total > 0 else 1
    start = (page - 1) * limit
    end = start + limit
    paginated = servers[start:end]

    return PaginatedResponse(
        items=[s.model_dump(by_alias=True) for s in paginated],
        total=total,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


@router.post("", response_model=ApiResponse)
async def create_mcp_server(
    config: MCPServerConfigCreate,
    user: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    """Create a new MCP server configuration.

    Requires admin role.
    """
    # Check if ID already exists
    existing = mongo.get_server(config.id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"MCP server with ID '{config.id}' already exists",
        )

    # Validate transport-specific fields
    _validate_transport_config(config)

    server = mongo.create_server(config)
    logger.info(f"Created MCP server '{config.name}' ({config.id}) by {user.email}")

    return ApiResponse(
        success=True,
        data=server.model_dump(by_alias=True),
    )


@router.get("/{server_id}", response_model=ApiResponse)
async def get_mcp_server(
    server_id: str,
    user: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    """Get an MCP server configuration by ID.

    Requires admin role.
    """
    server = mongo.get_server(server_id)

    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    return ApiResponse(
        success=True,
        data=server.model_dump(by_alias=True),
    )


@router.patch("/{server_id}", response_model=ApiResponse)
async def update_mcp_server(
    server_id: str,
    update: MCPServerConfigUpdate,
    user: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    """Update an MCP server configuration.

    Requires admin role. Config-driven servers cannot be updated.
    """
    server = mongo.get_server(server_id)

    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    # Block updates to config-driven servers
    if server.config_driven:
        raise HTTPException(
            status_code=403,
            detail="Config-driven MCP servers cannot be modified. Update config.yaml instead.",
        )

    updated = mongo.update_server(server_id, update)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update server")

    logger.info(f"Updated MCP server '{server_id}' by {user.email}")

    return ApiResponse(
        success=True,
        data=updated.model_dump(by_alias=True),
    )


@router.delete("/{server_id}", response_model=ApiResponse)
async def delete_mcp_server(
    server_id: str,
    user: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    """Delete an MCP server configuration.

    Requires admin role. Config-driven servers cannot be deleted.
    """
    server = mongo.get_server(server_id)

    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    # Block deletion of config-driven servers
    if server.config_driven:
        raise HTTPException(
            status_code=403,
            detail="Config-driven MCP servers cannot be deleted. Remove from config.yaml instead.",
        )

    deleted = mongo.delete_server(server_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Failed to delete server")

    logger.info(f"Deleted MCP server '{server_id}' by {user.email}")

    return ApiResponse(success=True, data={"deleted": server_id})


@router.post("/{server_id}/probe", response_model=MCPServerProbeResult)
async def probe_server(
    server_id: str,
    user: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> MCPServerProbeResult:
    """Probe an MCP server to discover available tools.

    Connects to the server and retrieves its tool manifest.
    This is an on-demand operation - tool manifests are NOT stored.

    Requires admin role.
    """
    server = mongo.get_server(server_id)

    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    if not server.enabled:
        return MCPServerProbeResult(
            server_id=server_id,
            success=False,
            error="Server is disabled",
        )

    # Probe the server
    try:
        tools = await probe_server_tools(server)
        result = MCPServerProbeResult(
            server_id=server_id,
            success=True,
            tools=tools,
        )
    except Exception as e:
        logger.exception(f"Failed to probe MCP server '{server_id}'")
        result = MCPServerProbeResult(
            server_id=server_id,
            success=False,
            error=str(e),
        )

    logger.info(f"Probed MCP server '{server_id}': success={result.success}, tools={len(result.tools or [])}")

    return result


def _validate_transport_config(config: MCPServerConfigCreate) -> None:
    """Validate that transport-specific fields are provided."""
    if config.transport == TransportType.STDIO:
        if not config.command:
            raise HTTPException(
                status_code=400,
                detail="'command' is required for stdio transport",
            )
    elif config.transport in (TransportType.SSE, TransportType.HTTP):
        if not config.endpoint:
            raise HTTPException(
                status_code=400,
                detail="'endpoint' is required for sse/http transport",
            )
