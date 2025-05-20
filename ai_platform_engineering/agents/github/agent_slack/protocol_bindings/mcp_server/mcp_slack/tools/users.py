"""User-related tools for Slack MCP"""

import logging
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
from ..api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("slack_mcp")

class SlackUser(BaseModel):
    """Model for Slack user"""
    id: str
    team_id: Optional[str] = None
    name: Optional[str] = None
    real_name: Optional[str] = None
    is_bot: Optional[bool] = None
    is_admin: Optional[bool] = None
    profile: Optional[Dict[str, Any]] = None

async def list_users(
    limit: int = 100,
    cursor: Optional[str] = None,
    include_locale: bool = False
) -> Dict[str, Any]:
    """
    List users in the Slack workspace
    
    Args:
        limit: Maximum number of users to return (default: 100)
        cursor: Pagination cursor for fetching additional pages
        include_locale: Whether to include locale information for users
        
    Returns:
        Dictionary containing users and pagination metadata
    """
    logger.debug("Listing users with parameters:")
    logger.debug(f"Limit: {limit}")
    logger.debug(f"Cursor: {cursor}")
    logger.debug(f"Include locale: {include_locale}")

    params = {
        "limit": limit,
        "include_locale": include_locale
    }
    
    if cursor:
        params["cursor"] = cursor

    logger.debug(f"Making API request with params: {params}")
    success, data = await make_api_request("users.list", params=params)

    if not success:
        logger.error(f"Failed to list users: {data.get('error')}")
        return {"error": data.get("error", "Failed to list users")}

    logger.info(f"Successfully retrieved user list")
    users = [SlackUser(**user) for user in data.get("members", [])]
    return {
        "users": users,
        "response_metadata": data.get("response_metadata", {})
    }

async def get_user_info(user_id: str) -> Dict[str, Any]:
    """
    Get detailed information about a specific Slack user
    
    Args:
        user_id: ID of the user to retrieve information for (required)
        
    Returns:
        Dictionary containing user information
    """
    logger.debug(f"Getting info for user ID: {user_id}")

    params = {"user": user_id}
    
    logger.debug(f"Making API request with params: {params}")
    success, data = await make_api_request("users.info", params=params)

    if success:
        logger.info(f"Successfully retrieved info for user {user_id}")
        return {"user": SlackUser(**data.get("user", {}))}
    else:
        logger.error(f"Failed to get info for user {user_id}: {data.get('error')}")
        return {"error": data.get("error", "Failed to get user info")}

async def set_user_status(
    status_text: str,
    status_emoji: Optional[str] = None,
    status_expiration: Optional[int] = None
) -> Dict[str, Any]:
    """
    Set the status for the authenticated user
    
    Args:
        status_text: Text to set as status (required)
        status_emoji: Emoji to use for status
        status_expiration: Timestamp when status should expire (0 for no expiration)
        
    Returns:
        Dictionary containing updated profile information
    """
    logger.debug(f"Setting user status:")
    logger.debug(f"Status text: {status_text}")
    logger.debug(f"Status emoji: {status_emoji}")
    logger.debug(f"Status expiration: {status_expiration}")

    profile = {
        "status_text": status_text
    }
    
    if status_emoji:
        profile["status_emoji"] = status_emoji
        
    if status_expiration is not None:
        profile["status_expiration"] = status_expiration
    else:
        profile["status_expiration"] = 0

    status_data = {"profile": profile}
    
    logger.debug(f"Making API request with status data: {status_data}")
    success, data = await make_api_request("users.profile.set", data=status_data)

    if success:
        logger.info(f"User status updated successfully")
        return {"success": True, "profile": data.get("profile", {})}
    else:
        logger.error(f"Failed to set user status: {data.get('error')}")
        return {"error": data.get("error", "Failed to set user status")}
