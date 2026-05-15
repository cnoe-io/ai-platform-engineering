"""MCP Server probe endpoint.

All CRUD operations have been moved to the Next.js gateway.
DA only handles probe (requires Python MCP client to connect to servers).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from dynamic_agents.auth.auth import UserContext, get_user_context
from dynamic_agents.models import MCPServerProbeResult
from dynamic_agents.services.mcp_client import probe_server_tools
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mcp-servers", tags=["mcp-servers"])


@router.post("/{server_id}/probe", response_model=MCPServerProbeResult)
async def probe_server(
    server_id: str,
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> MCPServerProbeResult:
    """Probe an MCP server to discover available tools.

    Connects to the server and retrieves its tool manifest.
    This is an on-demand operation - tool manifests are NOT stored.

    Requires admin role (checked via X-User-Context from gateway).
    """
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

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
