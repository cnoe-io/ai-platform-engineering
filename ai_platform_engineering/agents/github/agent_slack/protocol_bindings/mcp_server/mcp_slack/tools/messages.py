"""Message-related tools for Slack MCP Server"""

import logging
import os
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
from ..api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("slack_mcp")

class MessageModel(BaseModel):
    """Model for Slack message"""
    type: str
    text: str
    user: Optional[str] = None
    ts: Optional[str] = None
    thread_ts: Optional[str] = None
    reply_count: Optional[int] = None
    reactions: Optional[List[Dict[str, Any]]] = None

def api_format_to_message(message_data: Dict[str, Any]) -> Dict[str, Any]:
    """Convert API response format to standardized message format"""
    return {
        "type": message_data.get("type", "message"),
        "text": message_data.get("text", ""),
        "user": message_data.get("user", ""),
        "ts": message_data.get("ts", ""),
        "thread_ts": message_data.get("thread_ts", ""),
        "reply_count": message_data.get("reply_count", 0),
        "reactions": message_data.get("reactions", [])
    }

async def list_messages(
    channel_id: str,
    limit: int = 100,
    cursor: Optional[str] = None,
    latest: Optional[str] = None,
    oldest: Optional[str] = None
) -> Dict[str, Any]:
    """
    List messages in a Slack channel.
    
    Args:
        channel_id: ID of the channel to get messages from
        limit: Maximum number of messages to return (default: 100)
        cursor: Pagination cursor for large result sets
        latest: Return messages newer than this timestamp
        oldest: Return messages older than this timestamp
        
    Returns:
        Dict containing messages and pagination metadata
        
    Example response: 
        {
            "messages": [{"type": "message", "text": "Hello", "user": "U12345", ...}],
            "response_metadata": {"next_cursor": "..."}
        }
    """
    logger.debug("Getting messages with filters:")
    logger.debug(f"Channel ID: {channel_id}")
    logger.debug(f"Limit: {limit}")
    logger.debug(f"Cursor: {cursor}")
    logger.debug(f"Latest: {latest}")
    logger.debug(f"Oldest: {oldest}")

    params = {
        "channel": channel_id,
        "limit": limit
    }
    if cursor:
        params["cursor"] = cursor
    if latest:
        params["latest"] = latest
    if oldest:
        params["oldest"] = oldest

    logger.debug(f"Making API request with params: {params}")
    success, data = await make_api_request("conversations.history", params=params)
    
    if not success:
        logger.error(f"Failed to list messages: {data.get('error')}")
        return {"error": data.get("error", "Failed to list messages")}

    messages = [api_format_to_message(msg) for msg in data.get("messages", [])]
    logger.info(f"Successfully retrieved {len(messages)} messages from channel {channel_id}")
    
    return {
        "messages": messages,
        "response_metadata": data.get("response_metadata", {})
    }

async def get_thread_replies(
    channel_id: str, 
    thread_ts: str,
    limit: int = 100,
    cursor: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get replies in a message thread.
    
    Args:
        channel_id: ID of the channel containing the thread
        thread_ts: Timestamp of the parent message
        limit: Maximum number of replies to return (default: 100)
        cursor: Pagination cursor for large result sets
        
    Returns:
        Dict containing thread replies and pagination metadata
        
    Example response: 
        {
            "messages": [{"type": "message", "thread_ts": "1234567890.123456", ...}],
            "response_metadata": {"next_cursor": "..."}
        }
    """
    logger.debug(f"Getting thread replies for thread {thread_ts} in channel {channel_id}")
    logger.debug(f"Limit: {limit}")
    logger.debug(f"Cursor: {cursor}")

    params = {
        "channel": channel_id,
        "ts": thread_ts,
        "limit": limit
    }
    if cursor:
        params["cursor"] = cursor

    logger.debug(f"Making API request with params: {params}")
    success, data = await make_api_request("conversations.replies", params=params)
    
    if not success:
        logger.error(f"Failed to get thread replies: {data.get('error')}")
        return {"error": data.get("error", "Failed to get thread replies")}

    messages = [api_format_to_message(msg) for msg in data.get("messages", [])]
    logger.info(f"Successfully retrieved {len(messages)} replies from thread {thread_ts}")
    
    return {
        "messages": messages,
        "response_metadata": data.get("response_metadata", {})
    }

async def post_message(
    channel_id: str,
    text: str,
    thread_ts: Optional[str] = None,
    blocks: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Post a new message to a Slack channel.
    
    Args:
        channel_id: ID of the channel to post to
        text: Message text content
        thread_ts: Optional thread timestamp to reply to
        blocks: Optional Slack Block Kit blocks
        
    Returns:
        Dict containing the posted message details
        
    Example response: 
        {
            "message": {"type": "message", "text": "Hello", "ts": "1234567890.123456", ...}
        }
    """
    logger.debug(f"Posting message to channel {channel_id}")
    logger.debug(f"Text length: {len(text)} characters")
    logger.debug(f"Thread TS: {thread_ts}")
    logger.debug(f"Blocks provided: {blocks is not None}")

    params = {
        "channel": channel_id,
        "text": text
    }
    if thread_ts:
        params["thread_ts"] = thread_ts
    if blocks:
        params["blocks"] = blocks

    logger.debug(f"Making API request with params: {params}")
    success, data = await make_api_request("chat.postMessage", method="POST", data=params)
    
    if success:
        logger.info(f"Successfully posted message to channel {channel_id}")
        return {"message": api_format_to_message(data.get("message", {}))}
    else:
        logger.error(f"Failed to post message: {data.get('error')}")
        return {"error": data.get("error", "Failed to post message")}

async def reply_to_thread(
    channel_id: str,
    thread_ts: str,
    text: str,
    blocks: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Reply to a thread in a Slack channel.
    
    Args:
        channel_id: ID of the channel containing the thread
        thread_ts: Timestamp of the parent message
        text: Reply text content
        blocks: Optional Slack Block Kit blocks
        
    Returns:
        Dict containing the reply message details
        
    Example response: 
        {
            "message": {"type": "message", "text": "Reply", "ts": "1234567890.123456", ...}
        }
    """
    logger.debug(f"Replying to thread {thread_ts} in channel {channel_id}")
    logger.debug(f"Text length: {len(text)} characters")
    logger.debug(f"Blocks provided: {blocks is not None}")

    # Use the post_message function with thread_ts parameter
    return await post_message(
        channel_id=channel_id,
        text=text,
        thread_ts=thread_ts,
        blocks=blocks
    )

async def update_message(
    channel_id: str,
    ts: str,
    text: str,
    blocks: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Update an existing Slack message.
    
    Args:
        channel_id: ID of the channel containing the message
        ts: Timestamp of the message to update
        text: New message text
        blocks: Optional new Slack Block Kit blocks
        
    Returns:
        Dict containing the updated message details
        
    Example response: 
        {
            "message": {"type": "message", "text": "Updated text", "ts": "1234567890.123456", ...}
        }
    """
    logger.debug(f"Updating message {ts} in channel {channel_id}")
    logger.debug(f"New text length: {len(text)} characters")
    logger.debug(f"New blocks provided: {blocks is not None}")

    params = {
        "channel": channel_id,
        "ts": ts,
        "text": text
    }
    if blocks:
        params["blocks"] = blocks

    logger.debug(f"Making API request with params: {params}")
    success, data = await make_api_request("chat.update", method="POST", data=params)
    
    if success:
        logger.info(f"Successfully updated message {ts} in channel {channel_id}")
        return {"message": api_format_to_message(data.get("message", {}))}
    else:
        logger.error(f"Failed to update message: {data.get('error')}")
        return {"error": data.get("error", "Failed to update message")}

async def delete_message(
    channel_id: str,
    ts: str
) -> Dict[str, Any]:
    """
    Delete a Slack message.
    
    Args:
        channel_id: ID of the channel containing the message
        ts: Timestamp of the message to delete
        
    Returns:
        Dict indicating success or failure
        
    Example response: 
        {"success": true}
    """
    logger.debug(f"Deleting message {ts} in channel {channel_id}")

    success, data = await make_api_request(
        "chat.delete",
        method="POST",
        data={"channel": channel_id, "ts": ts}
    )
    
    if success:
        logger.info(f"Successfully deleted message {ts} from channel {channel_id}")
        return {"success": True}
    else:
        logger.error(f"Failed to delete message: {data.get('error')}")
        return {"error": data.get("error", "Failed to delete message")}

async def add_reaction(
    channel_id: str,
    ts: str,
    name: str
) -> Dict[str, Any]:
    """
    Add a reaction emoji to a message.
    
    Args:
        channel_id: ID of the channel containing the message
        ts: Timestamp of the message to react to
        name: Name of the reaction emoji (without colons)
        
    Returns:
        Dict indicating success or failure
        
    Example response: 
        {"success": true}
    """
    logger.debug(f"Adding reaction '{name}' to message {ts} in channel {channel_id}")

    success, data = await make_api_request(
        "reactions.add",
        method="POST",
        data={
            "channel": channel_id,
            "timestamp": ts,
            "name": name
        }
    )
    
    if success:
        logger.info(f"Successfully added reaction '{name}' to message {ts}")
        return {"success": True}
    else:
        logger.error(f"Failed to add reaction: {data.get('error')}")
        return {"error": data.get("error", "Failed to add reaction")}

async def remove_reaction(
    channel_id: str,
    ts: str,
    name: str
) -> Dict[str, Any]:
    """
    Remove a reaction emoji from a message.
    
    Args:
        channel_id: ID of the channel containing the message
        ts: Timestamp of the message
        name: Name of the reaction emoji to remove (without colons)
        
    Returns:
        Dict indicating success or failure
        
    Example response: 
        {"success": true}
    """
    logger.debug(f"Removing reaction '{name}' from message {ts} in channel {channel_id}")

    success, data = await make_api_request(
        "reactions.remove",
        method="POST",
        data={
            "channel": channel_id,
            "timestamp": ts,
            "name": name
        }
    )
    
    if success:
        logger.info(f"Successfully removed reaction '{name}' from message {ts}")
        return {"success": True}
    else:
        logger.error(f"Failed to remove reaction: {data.get('error')}")
        return {"error": data.get("error", "Failed to remove reaction")}