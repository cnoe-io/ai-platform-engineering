"""Channel-related tools for Slack MCP Server"""

import logging
import os
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
from ..api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("slack_mcp")

class ChannelModel(BaseModel):
    """Model for Slack channel"""
    id: str
    name: str
    is_private: Optional[bool] = False
    is_archived: Optional[bool] = False
    created: Optional[int] = 0
    creator: Optional[str] = ""
    num_members: Optional[int] = 0
    topic: Optional[str] = ""
    purpose: Optional[str] = ""

def api_format_to_channel(channel_data: Dict[str, Any]) -> Dict[str, Any]:
    """Convert API response format to standardized channel format"""
    return {
        "id": channel_data.get("id", ""),
        "name": channel_data.get("name", ""),
        "is_private": channel_data.get("is_private", False),
        "is_archived": channel_data.get("is_archived", False),
        "created": channel_data.get("created", 0),
        "creator": channel_data.get("creator", ""),
        "num_members": channel_data.get("num_members", 0),
        "topic": channel_data.get("topic", {}).get("value", ""),
        "purpose": channel_data.get("purpose", {}).get("value", "")
    }

async def list_channels(
    limit: int = 100,
    cursor: Optional[str] = None,
    exclude_archived: bool = True
) -> Dict[str, Any]:
    """
    List channels in the Slack workspace.
    
    Args:
        limit: Maximum number of channels to return (default: 100)
        cursor: Pagination cursor for large result sets
        exclude_archived: Whether to exclude archived channels (default: True)
        
    Returns:
        Dict containing channels and pagination metadata
        
    Example response: 
        {
            "channels": [{"id": "C12345", "name": "general", ...}],
            "response_metadata": {"next_cursor": "..."}
        }
    """
    logger.debug("Getting channels with filters:")
    logger.debug(f"Limit: {limit}")
    logger.debug(f"Cursor: {cursor}")
    logger.debug(f"Exclude archived: {exclude_archived}")

    params = {
        "limit": limit,
        "exclude_archived": exclude_archived
    }
    if cursor:
        params["cursor"] = cursor

    logger.debug(f"Making API request with params: {params}")
    success, data = await make_api_request("conversations.list", params=params)
    
    if not success:
        logger.error(f"Failed to list channels: {data.get('error')}")
        return {"error": data.get("error", "Failed to list channels")}

    channels = [api_format_to_channel(channel) for channel in data.get("channels", [])]
    logger.info(f"Successfully retrieved {len(channels)} channels")
    
    return {
        "channels": channels,
        "response_metadata": data.get("response_metadata", {})
    }

async def join_channel(channel_id: str) -> Dict[str, Any]:
    """
    Join a Slack channel.
    
    Args:
        channel_id: ID of the channel to join
        
    Returns:
        Dict containing the result of the join operation
        
    Example response: 
        {
            "success": true, 
            "channel": {"id": "C12345", "name": "general", ...}
        }
    """
    logger.debug(f"Joining channel with ID: {channel_id}")

    success, data = await make_api_request(
        "conversations.join",
        method="POST",
        data={"channel": channel_id}
    )
    
    if success:
        logger.info(f"Successfully joined channel {channel_id}")
        return {
            "success": True, 
            "channel": api_format_to_channel(data.get("channel", {}))
        }
    else:
        logger.error(f"Failed to join channel {channel_id}: {data.get('error')}")
        return {"error": data.get("error", "Failed to join channel")}

async def leave_channel(channel_id: str) -> Dict[str, Any]:
    """
    Leave a Slack channel.
    
    Args:
        channel_id: ID of the channel to leave
        
    Returns:
        Dict indicating success or failure
        
    Example response: 
        {"success": true}
    """
    logger.debug(f"Leaving channel with ID: {channel_id}")

    success, data = await make_api_request(
        "conversations.leave",
        method="POST",
        data={"channel": channel_id}
    )
    
    if success:
        logger.info(f"Successfully left channel {channel_id}")
        return {"success": True}
    else:
        logger.error(f"Failed to leave channel {channel_id}: {data.get('error')}")
        return {"error": data.get("error", "Failed to leave channel")}

async def get_channel_info(channel_id: str) -> Dict[str, Any]:
    """
    Get detailed information about a specific channel.
    
    Args:
        channel_id: ID of the channel to retrieve information for
        
    Returns:
        Dict containing detailed channel information
        
    Example response:
        {
            "id": "C12345",
            "name": "general",
            "is_private": false,
            "is_archived": false,
            "created": 1503435956,
            "creator": "U12345",
            "num_members": 10,
            "topic": "Company-wide announcements and work-based matters",
            "purpose": "This channel is for workspace-wide communication"
        }
    """
    logger.debug(f"Getting info for channel ID: {channel_id}")

    success, data = await make_api_request(
        "conversations.info",
        params={"channel": channel_id}
    )
    
    if success:
        channel = data.get("channel", {})
        logger.info(f"Successfully retrieved info for channel {channel_id}")
        
        return api_format_to_channel(channel)
    else:
        logger.error(f"Failed to get channel info for {channel_id}: {data.get('error')}")
        return {"error": data.get("error", "Failed to get channel info")}