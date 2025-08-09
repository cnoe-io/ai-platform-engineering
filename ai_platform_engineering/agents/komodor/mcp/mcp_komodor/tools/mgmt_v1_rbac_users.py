"""Tools for /mgmt/v1/rbac/users operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def rbac_user_controller_v1_get_all() -> Dict[str, Any]:
    '''
    Fetches all RBAC users from the management API.

    This function makes an asynchronous GET request to the '/mgmt/v1/rbac/users' endpoint
    to retrieve a list of all users with role-based access control (RBAC) settings.

    Args:
        None

    Returns:
        Dict[str, Any]: The JSON response from the API call containing user data.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /mgmt/v1/rbac/users")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/mgmt/v1/rbac/users", method="GET", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response