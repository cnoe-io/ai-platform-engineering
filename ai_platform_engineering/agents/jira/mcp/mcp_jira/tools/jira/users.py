"""User operations for Jira MCP"""

import json
import logging

from pydantic import BaseModel
from requests.exceptions import HTTPError

from mcp_jira.exceptions import MCPJiraAuthenticationError
from mcp_jira.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira")

class JiraUser(BaseModel):
    """Model for Jira user"""
    accountId: str
    displayName: str
    emailAddress: str
    active: bool
    timeZone: str

async def handle_user_operations(
    action: str,
    identifier: str = None,
    query: str = None,
) -> str:
    """
    Unified function to handle all user-related operations in Jira.

    Args:
        action: The type of action to perform (e.g., 'get_user', 'search_users', 'get_user_profile').
        identifier: The user's identifier (e.g., account ID, username, or email).
        query: The search query for users.

    Returns:
        JSON string representing the result of the operation.

    Raises:
        ValueError: If the Jira client is not configured or available (for 'get_user_profile').
        Exception: If the API request fails.
    """
    # Auto-correct: if action is 'get_user' but identifier looks like email, use 'search_users' instead
    if action == "get_user" and identifier and "@" in identifier:
        logger.warning(f"Auto-correcting: get_user with email '{identifier}' → search_users")
        action = "search_users"
        query = identifier
        identifier = None

    if action == "get_user_profile":
        logger.debug(f"Fetching user profile for identifier: {identifier}")
        params = {"accountId": identifier}
        path = "rest/api/3/user"
    elif action == "get_user":
        logger.debug(f"Fetching details for user {identifier}")
        params = {"accountId": identifier}
        path = "rest/api/3/user"
    elif action == "search_users":
        logger.debug(f"Searching for users with query: {query}")
        params = {"query": query}
        path = "rest/api/3/user/search"
    else:
        raise ValueError(f"Invalid action: {action}")

    try:
        success, response = await make_api_request(
            path=path,
            method="GET",
            params=params,
        )
        logger.debug(f"Jira user response: {response}")

        if not success:
            raise Exception(f"Failed to perform action '{action}': {response}")

        if action == "search_users":
            result = [JiraUser(**user).dict() for user in response]
        else:
            result = JiraUser(**response).dict()

        response_data = {"success": True, "result": result}
    except Exception as e:
        error_message = str(e)
        log_level = logging.ERROR

        if isinstance(e, ValueError) and "not found" in error_message.lower():
            log_level = logging.WARNING
        elif isinstance(e, MCPJiraAuthenticationError):
            error_message = f"Authentication/Permission Error: {error_message}"
        elif isinstance(e, (OSError, HTTPError)):
            error_message = f"Network or API Error: {error_message}"
        else:
            logger.exception(f"Unexpected error in action '{action}': {error_message}")

        response_data = {
            "success": False,
            "error": error_message,
            "action": action,
            "identifier": identifier,
            "query": query,
        }
        logger.log(log_level, f"Action '{action}' failed: {error_message}")

    return json.dumps(response_data, indent=2, ensure_ascii=False)

async def get_current_user_account_id() -> str:
    """Get the account ID of the current user."""
    logger.debug("Fetching current user account ID")
    success, response = await make_api_request(
        path="rest/api/3/myself",
        method="GET",
    )
    if not success:
        raise Exception(f"Failed to fetch current user account ID: {response}")

    account_id = response.get("accountId")
    if not account_id:
        raise ValueError("Account ID not found in response")

    return account_id
