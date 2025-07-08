"""Tools for /mgmt/v1/rbac/roles/{id}/policies operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def rbac_role_policies_controller_v1_get(path_id: str) -> Dict[str, Any]:
    '''
    Fetches the policies associated with a specific RBAC role.

    Args:
        path_id (str): The UUID of the role for which policies are being retrieved.

    Returns:
        Dict[str, Any]: The JSON response from the API call containing the policies associated with the specified role.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /mgmt/v1/rbac/roles/{id}/policies")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/mgmt/v1/rbac/roles/{path_id}/policies", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response