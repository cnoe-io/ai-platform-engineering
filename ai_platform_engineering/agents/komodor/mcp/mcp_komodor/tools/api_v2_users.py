"""Tools for /api/v2/users operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_users(
    param_displayName: str = None, param_email: str = None, param_isDeleted: bool = False
) -> Dict[str, Any]:
    '''
    Get Users.

    Args:
        param_displayName (str, optional): The display name of the user to filter by. Defaults to None.
        param_email (str, optional): The email of the user to filter by. Defaults to None.
        param_isDeleted (bool, optional): Filter users based on their deletion status. 
            If True, only deleted users are returned. If False, only non-deleted users are returned. 
            Defaults to False.

    Returns:
        Dict[str, Any]: The JSON response from the API call containing user data.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /api/v2/users")

    params = {}
    data = {}

    if param_displayName is not None:
        params["displayName"] = (
            str(param_displayName).lower() if isinstance(param_displayName, bool) else param_displayName
        )

    if param_email is not None:
        params["email"] = str(param_email).lower() if isinstance(param_email, bool) else param_email

    if param_isDeleted is not None:
        params["isDeleted"] = str(param_isDeleted).lower() if isinstance(param_isDeleted, bool) else param_isDeleted

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/api/v2/users", method="GET", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def post_api_v2_users(
    body_displayName: str, body_email: str, body_restoreIfDeleted: bool = None
) -> Dict[str, Any]:
    '''
    Create a User.

    Args:
        body_displayName (str): The display name of the user to be created.
        body_email (str): The email address of the user to be created.
        body_restoreIfDeleted (bool, optional): Flag indicating whether to restore the user 
            if they were previously marked as deleted. Defaults to None.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing user details or error information.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making POST request to /api/v2/users")

    params = {}
    data = {}

    flat_body = {}
    if body_displayName is not None:
        flat_body["displayName"] = body_displayName
    if body_email is not None:
        flat_body["email"] = body_email
    if body_restoreIfDeleted is not None:
        flat_body["restoreIfDeleted"] = body_restoreIfDeleted
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/api/v2/users", method="POST", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response