"""Tools for /mgmt/v1/rbac/users/roles operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def rbac_user_roles_controller_v1_post(
    body_userId: str, body_roleId: str, body_expiration: str
) -> Dict[str, Any]:
    '''
    Assigns a role to a user with an optional expiration date.

    Args:
        body_userId (str): The ID of the user to whom the role will be assigned.
        body_roleId (str): The ID of the role to be assigned to the user.
        body_expiration (str): The expiration date for the role assignment in ISO 8601 format. Optional.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the result of the role assignment.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making POST request to /mgmt/v1/rbac/users/roles")

    params = {}
    data = {}

    flat_body = {}
    if body_userId is not None:
        flat_body["userId"] = body_userId
    if body_roleId is not None:
        flat_body["roleId"] = body_roleId
    if body_expiration is not None:
        flat_body["expiration"] = body_expiration
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/mgmt/v1/rbac/users/roles", method="POST", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def rbac_user_roles_controller_v1_delete(
    body_userId: str, body_roleId: str, body_expiration: str
) -> Dict[str, Any]:
    '''
    Deletes a user role in the RBAC system.

    Args:
        body_userId (str): The ID of the user whose role is to be deleted.
        body_roleId (str): The ID of the role to be deleted from the user.
        body_expiration (str): The expiration date for the role assignment.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the result of the deletion operation.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making DELETE request to /mgmt/v1/rbac/users/roles")

    params = {}
    data = {}

    flat_body = {}
    if body_userId is not None:
        flat_body["userId"] = body_userId
    if body_roleId is not None:
        flat_body["roleId"] = body_roleId
    if body_expiration is not None:
        flat_body["expiration"] = body_expiration
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/mgmt/v1/rbac/users/roles", method="DELETE", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response