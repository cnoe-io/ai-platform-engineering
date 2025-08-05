"""Tools for /mgmt/v1/rbac/actions/{id} operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def actions_controller_v1_delete(path_id: str) -> Dict[str, Any]:
    '''
    Deletes an action specified by the UUID.

    Args:
        path_id (str): UUID of the action to be deleted.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the result of the delete operation.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making DELETE request to /mgmt/v1/rbac/actions/{id}")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/mgmt/v1/rbac/actions/{path_id}", method="DELETE", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def actions_controller_v1_update(
    path_id: str, body_description: str, body_k8sRuleset: List[str]
) -> Dict[str, Any]:
    '''
    Updates an action in the RBAC system with the specified details.

    Args:
        path_id (str): The UUID of the policy to update.
        body_description (str): The description of the action to be updated.
        body_k8sRuleset (List[str]): The Kubernetes ruleset associated with the action.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the updated action details.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making PUT request to /mgmt/v1/rbac/actions/{id}")

    params = {}
    data = {}

    flat_body = {}
    if body_description is not None:
        flat_body["description"] = body_description
    if body_k8sRuleset is not None:
        flat_body["k8sRuleset"] = body_k8sRuleset
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/mgmt/v1/rbac/actions/{path_id}", method="PUT", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response