"""Slack API client for MCP

This module provides a client for interacting with the Slack API.
It handles authentication, request formatting, and response parsing.
"""

import os
import logging
from typing import Optional, Dict, Any, List, Tuple
import httpx
from dotenv import load_dotenv
from pathlib import Path


# Get the correct path to the .env file
# client.py is in agent_slack/slack_mcp/api/
# We need to go up 4 levels to get to agent-slack root
file_path = Path(__file__)
project_root = file_path.parent.parent.parent.parent  # Navigate up to agent-slack root
env_path = project_root / '.env'

# Load environment variables with the specific path
load_dotenv(dotenv_path=env_path)

# Constants
SLACK_API_URL = "https://slack.com/api"
DEFAULT_TIMEOUT = 30
DEFAULT_TOKEN = None
if "SLACK_BOT_TOKEN" in os.environ:
    DEFAULT_TOKEN = os.environ["SLACK_BOT_TOKEN"]
elif "SLACK_TOKEN" in os.environ:
    DEFAULT_TOKEN = os.environ["SLACK_TOKEN"]

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("slack_mcp")

# Log the path where we're looking for the .env file
logger.info(f"Looking for .env file at: {env_path}")
logger.info(f"Absolute path: {env_path.absolute()}")
if env_path.exists():
    logger.info(f".env file found at {env_path}")
else:
    logger.warning(f".env file NOT found at {env_path}")
    # Try alternative path - just in case
    alt_path = Path("C:/Users/harmi/UCL/slack_agent_itr1/agent-slack/.env")
    logger.info(f"Trying alternative path: {alt_path}")
    if alt_path.exists():
        logger.info(f".env file found at alternative path {alt_path}")
        load_dotenv(dotenv_path=alt_path)
    else:
        logger.warning(f".env file NOT found at alternative path either")

# Log token presence but not the token itself
if DEFAULT_TOKEN:
    logger.info("Default Slack token found in environment variables")
else:
    logger.warning("No default Slack token found in environment variables")

class SlackClient:
    """Client for interacting with Slack API"""
    
    def __init__(self, bot_token: Optional[str] = None):
        """
        Initialize the Slack client
        
        Args:
            bot_token: Slack bot token (defaults to environment variable if not provided)
        """
        self.bot_token = bot_token or DEFAULT_TOKEN
        if not self.bot_token:
            logger.error("No Slack bot token provided or found in environment")
            raise ValueError("Slack bot token is required")
            
        self.headers = {
            "Authorization": f"Bearer {self.bot_token}",
            "Content-Type": "application/json"
        }
        
        self.team_id = os.getenv("SLACK_TEAM_ID")
        if not self.team_id:
            logger.warning("SLACK_TEAM_ID not set, some operations may be limited")

    async def get_channels(self, limit: int = 100, cursor: Optional[str] = None) -> Dict[str, Any]:
        """
        Get list of channels in the workspace
        
        Args:
            limit: Maximum number of channels to return (default: 100)
            cursor: Pagination cursor for fetching additional pages
            
        Returns:
            Dictionary containing channel information
        """
        logger.debug(f"Getting channels with limit={limit}, cursor={cursor}")
        predefined_channel_ids = os.getenv("SLACK_CHANNEL_IDS")
        
        if predefined_channel_ids:
            logger.debug(f"Using predefined channel IDs: {predefined_channel_ids}")
            channels = []
            for channel_id in predefined_channel_ids.split(","):
                channel_id = channel_id.strip()
                logger.debug(f"Fetching info for channel: {channel_id}")
                response = await self._make_request(
                    "conversations.info",
                    params={"channel": channel_id}
                )
                if response.get("ok") and response.get("channel") and not response["channel"].get("is_archived"):
                    channels.append(response["channel"])
            
            logger.debug(f"Found {len(channels)} active channels from predefined IDs")
            return {
                "ok": True,
                "channels": channels,
                "response_metadata": {"next_cursor": ""}
            }

        logger.debug("Fetching all available channels")
        params = {
            "types": "public_channel",
            "exclude_archived": "true",
            "limit": min(limit, 200),  # Slack API maximum limit
            "team_id": self.team_id
        }
        if cursor:
            params["cursor"] = cursor

        return await self._make_request("conversations.list", params=params)

    async def post_message(self, channel_id: str, text: str, blocks: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """
        Post a message to a channel
        
        Args:
            channel_id: ID of the channel to post to
            text: Message text
            blocks: Optional blocks for rich formatting
            
        Returns:
            API response data
        """
        logger.debug(f"Posting message to channel {channel_id}")
        data = {"channel": channel_id, "text": text}
        
        if blocks:
            data["blocks"] = blocks
            
        return await self._make_request(
            "chat.postMessage",
            method="POST",
            data=data
        )

    async def post_reply(self, channel_id: str, thread_ts: str, text: str) -> Dict[str, Any]:
        """
        Reply to a thread
        
        Args:
            channel_id: ID of the channel containing the thread
            thread_ts: Timestamp of the parent message
            text: Reply text
            
        Returns:
            API response data
        """
        logger.debug(f"Posting reply to thread {thread_ts} in channel {channel_id}")
        return await self._make_request(
            "chat.postMessage",
            method="POST",
            data={
                "channel": channel_id,
                "thread_ts": thread_ts,
                "text": text
            }
        )

    async def add_reaction(self, channel_id: str, timestamp: str, reaction: str) -> Dict[str, Any]:
        """
        Add a reaction to a message
        
        Args:
            channel_id: ID of the channel containing the message
            timestamp: Timestamp of the message
            reaction: Name of the reaction emoji (without colons)
            
        Returns:
            API response data
        """
        logger.debug(f"Adding reaction '{reaction}' to message {timestamp} in channel {channel_id}")
        return await self._make_request(
            "reactions.add",
            method="POST",
            data={
                "channel": channel_id,
                "timestamp": timestamp,
                "name": reaction
            }
        )

    async def get_channel_history(self, channel_id: str, limit: int = 10, oldest: Optional[str] = None, latest: Optional[str] = None) -> Dict[str, Any]:
        """
        Get channel message history
        
        Args:
            channel_id: ID of the channel
            limit: Maximum number of messages to return (default: 10)
            oldest: Start of time range (timestamp)
            latest: End of time range (timestamp)
            
        Returns:
            API response data with message history
        """
        logger.debug(f"Getting history for channel {channel_id}, limit={limit}")
        params = {
            "channel": channel_id,
            "limit": limit
        }
        
        if oldest:
            params["oldest"] = oldest
            
        if latest:
            params["latest"] = latest
            
        return await self._make_request("conversations.history", params=params)

    async def get_thread_replies(self, channel_id: str, thread_ts: str, limit: int = 100) -> Dict[str, Any]:
        """
        Get thread replies
        
        Args:
            channel_id: ID of the channel containing the thread
            thread_ts: Timestamp of the parent message
            limit: Maximum number of replies to return (default: 100)
            
        Returns:
            API response data with thread replies
        """
        logger.debug(f"Getting replies for thread {thread_ts} in channel {channel_id}")
        return await self._make_request(
            "conversations.replies",
            params={
                "channel": channel_id,
                "ts": thread_ts,
                "limit": limit
            }
        )

    async def get_users(self, limit: int = 100, cursor: Optional[str] = None) -> Dict[str, Any]:
        """
        Get list of users in the workspace
        
        Args:
            limit: Maximum number of users to return (default: 100)
            cursor: Pagination cursor for fetching additional pages
            
        Returns:
            API response data with user information
        """
        logger.debug(f"Getting users with limit={limit}, cursor={cursor}")
        params = {
            "limit": min(limit, 200),
            "team_id": self.team_id
        }
        if cursor:
            params["cursor"] = cursor

        return await self._make_request("users.list", params=params)

    async def get_user_profile(self, user_id: str) -> Dict[str, Any]:
        """
        Get detailed profile information for a user
        
        Args:
            user_id: ID of the user
            
        Returns:
            API response data with user profile
        """
        logger.debug(f"Getting profile for user {user_id}")
        return await self._make_request(
            "users.profile.get",
            params={
                "user": user_id,
                "include_labels": "true"
            }
        )
        
    async def update_user_status(self, status_text: str, status_emoji: Optional[str] = None, status_expiration: int = 0) -> Dict[str, Any]:
        """
        Update the authenticated user's status
        
        Args:
            status_text: Status text to display
            status_emoji: Emoji to display with the status
            status_expiration: Timestamp when status should expire (0 for no expiration)
            
        Returns:
            API response data
        """
        logger.debug(f"Updating user status: text='{status_text}', emoji={status_emoji}, expiration={status_expiration}")
        profile = {
            "status_text": status_text,
            "status_expiration": status_expiration
        }
        
        if status_emoji:
            profile["status_emoji"] = status_emoji
            
        return await self._make_request(
            "users.profile.set",
            method="POST",
            data={"profile": profile}
        )

    async def _make_request(
        self,
        endpoint: str,
        method: str = "GET",
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Make a request to the Slack API
        
        Args:
            endpoint: API endpoint to call (without base URL)
            method: HTTP method (GET, POST, etc.)
            params: Query parameters for the request
            data: JSON data for POST/PUT requests
            files: Files to upload
            
        Returns:
            Response data dictionary
        """
        url = f"{SLACK_API_URL}/{endpoint}"
        logger.debug(f"Making {method} request to {url}")
        
        if params:
            logger.debug(f"Request parameters: {params}")
            
        if data:
            # Log data but protect sensitive information
            safe_data = data.copy()
            if isinstance(safe_data.get("token"), str):
                safe_data["token"] = "[REDACTED]"
            logger.debug(f"Request data: {safe_data}")
        
        try:
            async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
                # Map HTTP methods to client methods
                method_map = {
                    "GET": client.get,
                    "POST": client.post,
                    "PUT": client.put,
                    "PATCH": client.patch,
                    "DELETE": client.delete,
                }
                
                if method not in method_map:
                    logger.error(f"Unsupported HTTP method: {method}")
                    return {"ok": False, "error": f"Unsupported HTTP method: {method}"}
                
                # Prepare request kwargs
                request_kwargs = {
                    "headers": self.headers,
                    "params": params,
                }
                
                if method != "GET":
                    request_kwargs["json"] = data
                    
                if files:
                    request_kwargs["files"] = files
                    
                # Make the request
                response = await method_map[method](url, **request_kwargs)
                
                logger.debug(f"Response status code: {response.status_code}")
                
                # Handle response
                response.raise_for_status()
                data = response.json()
                
                if data.get("ok"):
                    logger.debug("API request successful")
                    return data
                else:
                    error = data.get("error", "Unknown error")
                    logger.error(f"Slack API error: {error}")
                    return data
                    
        except httpx.TimeoutException:
            logger.error(f"Request timed out after {DEFAULT_TIMEOUT} seconds")
            return {"ok": False, "error": f"Request timed out after {DEFAULT_TIMEOUT} seconds"}
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error: {e.response.status_code} - {str(e)}")
            return {"ok": False, "error": f"HTTP error: {e.response.status_code} - {str(e)}"}
        except httpx.RequestError as e:
            # Ensure no sensitive data is included in error messages
            error_message = str(e)
            if self.bot_token and self.bot_token in error_message:
                error_message = error_message.replace(self.bot_token, "[REDACTED]")
            logger.error(f"Request error: {error_message}")
            return {"ok": False, "error": f"Request error: {error_message}"}
        except Exception as e:
            # Ensure no sensitive data is included in error messages
            error_message = str(e)
            if self.bot_token and self.bot_token in error_message:
                error_message = error_message.replace(self.bot_token, "[REDACTED]")
            logger.error(f"Unexpected error: {error_message}")
            return {"ok": False, "error": f"Unexpected error: {error_message}"}

async def make_api_request(
    endpoint: str,
    method: str = "GET",
    params: Optional[Dict[str, Any]] = None,
    data: Optional[Dict[str, Any]] = None,
    files: Optional[Dict[str, Any]] = None,
    token: Optional[str] = None,
    timeout: int = DEFAULT_TIMEOUT
) -> Tuple[bool, Dict[str, Any]]:
    """
    Make a request to the Slack API.
    
    Args:
        endpoint: API endpoint to call (without base URL)
        method: HTTP method (GET, POST, etc.)
        params: Query parameters for the request
        data: JSON data for POST/PUT/PATCH requests
        files: Files to upload
        token: Slack API token (defaults to environment variable)
        timeout: Request timeout in seconds
        
    Returns:
        Tuple of (success, response_data)
    """
    logger.debug(f"Making {method} request to {endpoint}")
    
    # Check environment variables directly for debugging
    env_token = os.getenv("SLACK_BOT_TOKEN")
    logger.debug(f"SLACK_BOT_TOKEN in environment: {'Yes' if env_token else 'No'}")
    
    # Get token from param or environment
    token = token or DEFAULT_TOKEN
    logger.debug(f"Using token from {'parameter' if token != DEFAULT_TOKEN else 'environment'}")
    
    if not token:
        logger.error("Slack token not found in params or environment")
        # Try to get it directly one more time to be sure
        direct_token = os.environ.get("SLACK_BOT_TOKEN")
        if direct_token:
            logger.info("Found token directly in os.environ, using it")
            token = direct_token
        else:
            return False, {"error": "Missing Slack token"}

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    url = f"{SLACK_API_URL}/{endpoint}"
    logger.debug(f"Full request URL: {url}")
    
    if params:
        logger.debug(f"Request parameters: {params}")
        
    if data:
        # Log data but protect sensitive information
        safe_data = data.copy() if data else {}
        if isinstance(safe_data.get("token"), str):
            safe_data["token"] = "[REDACTED]"
        logger.debug(f"Request data: {safe_data}")
    
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            # Map HTTP methods to client methods
            method_map = {
                "GET": client.get,
                "POST": client.post,
                "PUT": client.put,
                "PATCH": client.patch,
                "DELETE": client.delete,
            }
            
            if method not in method_map:
                logger.error(f"Unsupported HTTP method: {method}")
                return False, {"error": f"Unsupported method: {method}"}
            
            # Prepare request kwargs
            request_kwargs = {
                "headers": headers,
                "params": params,
            }
            
            if method != "GET":
                request_kwargs["json"] = data
                
            if files:
                request_kwargs["files"] = files
            
            # Make the request
            response = await method_map[method](url, **request_kwargs)
            logger.debug(f"Response status code: {response.status_code}")
            
            # Handle different response codes
            response.raise_for_status()
            response_data = response.json()
            
            if response_data.get("ok"):
                logger.debug("API request successful")
                return True, response_data
            else:
                error = response_data.get("error", "Unknown error")
                logger.error(f"Slack API error: {error}")
                return False, response_data
                
    except httpx.TimeoutException:
        logger.error(f"Request timed out after {timeout} seconds")
        return False, {"error": f"Request timed out after {timeout} seconds"}
    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP error: {e.response.status_code} - {str(e)}")
        return False, {"error": f"HTTP error: {e.response.status_code} - {str(e)}"}
    except httpx.RequestError as e:
        # Ensure no sensitive data is included in error messages
        error_message = str(e)
        if token and token in error_message:
            error_message = error_message.replace(token, "[REDACTED]")
        logger.error(f"Request error: {error_message}")
        return False, {"error": f"Request error: {error_message}"}
    except Exception as e:
        # Ensure no sensitive data is included in error messages
        error_message = str(e)
        if token and token in error_message:
            error_message = error_message.replace(token, "[REDACTED]")
        logger.error(f"Unexpected error: {error_message}")
        return False, {"error": f"Unexpected error: {error_message}"}