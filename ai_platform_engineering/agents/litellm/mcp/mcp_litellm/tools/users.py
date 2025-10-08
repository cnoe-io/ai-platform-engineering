import httpx
import json
import os
import logging

from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")

async def create_user(name: str, email: str) -> str:
    """Create a new user in LiteLLM.

    Args:
        name: The user's display name
        email: The user's email address

    Returns:
        JSON string with user creation result including user_id
    """

    # Prepare request body for LiteLLM /user/new endpoint
    user_payload = {
        "user_alias": name,
        "user_email": email,
        "auto_create_key": False,
        "teams": [],  # Avoid null teams
        "metadata": {
            "username": name  # Store name in metadata as workaround
        },
    }

    data = assemble_nested_body(user_payload)
    success, response = await make_api_request("/user/new", method="POST", data=data)

    
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}

    metadata = response.get("metadata", {})

    result = {
        "user_id": response["user_id"],
        "name": metadata.get("username"),
        "email": response.get("user_email"),
        "projects": response.get("teams") or [],
    }

    return json.dumps({"success": True, "result": result}, indent=2)
