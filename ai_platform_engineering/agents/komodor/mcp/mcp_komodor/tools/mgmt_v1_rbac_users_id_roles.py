"""Tools for /mgmt/v1/rbac/users/{id}/roles operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def rbac_user_roles_controller_v1_get(path_id: str) -> Dict[str, Any]:
    '''
    Fetches the roles associated with a specific user in the RBAC system.

    Args:
        path_id (str): The UUID of the user whose roles are to be retrieved.

    Returns:
        Dict[str, Any]: A dictionary containing the JSON response from the API call, which includes the user's roles.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making GET request to /mgmt/v1/rbac/users/{id}/roles")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/mgmt/v1/rbac/users/{path_id}/roles", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response