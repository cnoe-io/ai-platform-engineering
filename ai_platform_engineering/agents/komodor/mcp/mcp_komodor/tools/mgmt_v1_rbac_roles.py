"""Tools for /mgmt/v1/rbac/roles operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def roles_controller_v1_get_all() -> Dict[str, Any]:
    '''
    Fetches all roles from the RBAC management API.

    This asynchronous function makes a GET request to the /mgmt/v1/rbac/roles endpoint
    to retrieve all roles available in the system.

    Args:
        None

    Returns:
        Dict[str, Any]: A dictionary containing the JSON response from the API call,
        which includes details of all roles.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised
        with the error details.
    '''
    logger.debug("Making GET request to /mgmt/v1/rbac/roles")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/mgmt/v1/rbac/roles", method="GET", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def roles_controller_v1_post(body_name: str) -> Dict[str, Any]:
    '''
    Creates a new role in the RBAC system by making a POST request to the /mgmt/v1/rbac/roles endpoint.

    Args:
        body_name (str): The name of the role to be created.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing details of the created role or an error message.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making POST request to /mgmt/v1/rbac/roles")

    params = {}
    data = {}

    flat_body = {}
    if body_name is not None:
        flat_body["name"] = body_name
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/mgmt/v1/rbac/roles", method="POST", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def roles_controller_v1_delete(body_id: str) -> Dict[str, Any]:
    '''
    Deletes a role by its ID using the RBAC roles management API.

    Args:
        body_id (str): The ID of the role to be deleted.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the result of the delete operation.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making DELETE request to /mgmt/v1/rbac/roles")

    params = {}
    data = {}

    flat_body = {}
    if body_id is not None:
        flat_body["id"] = body_id
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/mgmt/v1/rbac/roles", method="DELETE", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response