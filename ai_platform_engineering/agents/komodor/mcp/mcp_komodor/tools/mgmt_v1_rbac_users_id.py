"""Tools for /mgmt/v1/rbac/users/{id} operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def rbac_user_controller_v1_get(path_id: str) -> Dict[str, Any]:
    '''
    Fetches user details from the RBAC management API.

    Args:
        path_id (str): The UUID of the user whose details are to be retrieved.

    Returns:
        Dict[str, Any]: A dictionary containing the JSON response from the API call, which includes user details.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making GET request to /mgmt/v1/rbac/users/{id}")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(f"/mgmt/v1/rbac/users/{path_id}", method="GET", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response