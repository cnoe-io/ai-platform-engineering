"""Tools for /api/v2/rbac/policies operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def post_api_v2_rbac_policies(body_name: str, body_statements: List[str]) -> Dict[str, Any]:
    '''
    Create a new RBAC policy.

    Args:
        body_name (str): The name of the policy to be created.
        body_statements (List[str]): A list of statements that define the policy rules.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing details of the created policy.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making POST request to /api/v2/rbac/policies")

    params = {}
    data = {}

    flat_body = {}
    if body_name is not None:
        flat_body["name"] = body_name
    if body_statements is not None:
        flat_body["statements"] = body_statements
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/api/v2/rbac/policies", method="POST", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response