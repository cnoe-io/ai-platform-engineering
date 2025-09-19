import httpx
import json
import os
from typing import Optional


# Configuration - these would need to be set from environment or config
LITELLM_PROXY_URL = os.getenv("LITELLM_PROXY_URL", "http://localhost:4000")
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-1234")


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

    # Set headers including master key for authentication
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITELLM_MASTER_KEY}",
    }

    try:
        # Call the LiteLLM /team/list endpoint
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{LITELLM_PROXY_URL}/team/list", headers=headers, params=query_params
            )

            if resp.status_code != 200:
                return json.dumps(
                    {
                        "success": False,
                        "error": f"API Error {resp.status_code}: {resp.text}",
                    },
                    indent=2,
                )

            all_teams = resp.json()

            # Map the LiteLLM teams response to a plain dictionary
            projects = []
            for team in all_teams:
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

    except Exception as e:
        return json.dumps(
            {"success": False, "error": f"Error listing projects: {str(e)}"}, indent=2
        )
