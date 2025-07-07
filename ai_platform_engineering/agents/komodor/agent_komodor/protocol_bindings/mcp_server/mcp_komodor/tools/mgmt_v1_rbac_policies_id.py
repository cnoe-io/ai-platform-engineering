"""Tools for /mgmt/v1/rbac/policies/{id} operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def policies_controller_v1_get(path_id: str) -> Dict[str, Any]:
    '''
    Fetches the details of a specific policy using its UUID.

    Args:
        path_id (str): The UUID of the policy to retrieve.

    Returns:
        Dict[str, Any]: A dictionary containing the JSON response from the API call, which includes the policy details.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making GET request to /mgmt/v1/rbac/policies/{id}")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/mgmt/v1/rbac/policies/{path_id}", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def policies_controller_v1_update_policy(
    path_id: str, body_name: str, body_statements: List[str]
) -> Dict[str, Any]:
    '''
    Updates a policy in the RBAC management system.

    Args:
        path_id (str): The UUID of the policy to be updated.
        body_name (str): The name of the policy as specified in the request body.
        body_statements (List[str]): A list of statements associated with the policy as specified in the request body.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the updated policy details or an error message.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making PUT request to /mgmt/v1/rbac/policies/{id}")

    params = {}
    data = {}

    flat_body = {}
    if body_name is not None:
        flat_body["name"] = body_name
    if body_statements is not None:
        flat_body["statements"] = body_statements
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/mgmt/v1/rbac/policies/{path_id}", method="PUT", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response