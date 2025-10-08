import httpx
import json
import os
from typing import Optional
import logging


from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def list_projects(user_id: Optional[str] = None) -> str:
    """List all projects/teams in LiteLLM with optional user filtering.

    Args:
        user_id: Optional user ID to filter projects by specific user

    Returns:
        JSON string with list of projects and their details
    """

    # Prepare query parameters for LiteLLM API call
    query_params = {}
    if user_id:
        query_params["user_id"] = user_id

    success, response = await make_api_request("/team/list", method="GET", params=query_params)


    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    
    # Map the LiteLLM teams response to a plain dictionary
    projects = []
    for team in response:
        project_info = {
            "team_id": team.get("team_id"),
            "team_alias": team.get("team_alias"),
            "members": team.get("members", []),
            "metadata": team.get("metadata", {}),
            "models": team.get("models", []),
            "spend": team.get("spend", 0),
            "max_budget": team.get("max_budget"),
            "created_at": team.get("created_at"),
            "updated_at": team.get("updated_at"),
        }
        projects.append(project_info)

    result = {"projects": projects, "total": len(projects)}

    return json.dumps({"success": True, "result": result}, indent=2)