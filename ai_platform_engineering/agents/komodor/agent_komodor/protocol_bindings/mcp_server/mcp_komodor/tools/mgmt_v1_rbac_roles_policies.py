"""Tools for /mgmt/v1/rbac/roles/policies operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def rbac_role_policies_controller_v1_post(body_roleId: str, body_policyId: str) -> Dict[str, Any]:
    '''
    Creates a new role-policy association in the RBAC system.

    Args:
        body_roleId (str): The ID of the role to associate with a policy.
        body_policyId (str): The ID of the policy to associate with a role.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing details of the created association.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making POST request to /mgmt/v1/rbac/roles/policies")

    params = {}
    data = {}

    flat_body = {}
    if body_roleId is not None:
        flat_body["roleId"] = body_roleId
    if body_policyId is not None:
        flat_body["policyId"] = body_policyId
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/mgmt/v1/rbac/roles/policies", method="POST", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def rbac_role_policies_controller_v1_delete(body_roleId: str, body_policyId: str) -> Dict[str, Any]:
    '''
    Deletes a policy from a role in the RBAC system.

    Args:
        body_roleId (str): The ID of the role from which the policy will be deleted.
        body_policyId (str): The ID of the policy to be deleted from the role.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the result of the delete operation.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making DELETE request to /mgmt/v1/rbac/roles/policies")

    params = {}
    data = {}

    flat_body = {}
    if body_roleId is not None:
        flat_body["roleId"] = body_roleId
    if body_policyId is not None:
        flat_body["policyId"] = body_policyId
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        "/mgmt/v1/rbac/roles/policies", method="DELETE", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response