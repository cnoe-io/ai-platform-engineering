"""Builtin tools discovery endpoint.

Returns available built-in tools and their configuration options,
allowing the UI to dynamically render tool configuration without
hardcoding tool definitions.
"""

from fastapi import APIRouter

from dynamic_agents.services.builtin_tools import get_builtin_tool_definitions

router = APIRouter(prefix="/builtin-tools", tags=["builtin-tools"])


@router.get("")
async def list_builtin_tools() -> dict:
    """List available built-in tools with their configuration options.

    Returns tool definitions including:
    - id: Tool identifier
    - name: Display name
    - description: What the tool does
    - enabled_by_default: Whether enabled by default for new agents
    - config_fields: Configurable parameters with types and defaults

    No authentication required - this is just static metadata.
    """
    tools = get_builtin_tool_definitions()
    return {
        "success": True,
        "data": {
            "tools": [tool.model_dump() for tool in tools],
        },
    }
