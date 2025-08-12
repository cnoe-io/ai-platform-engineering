"""Tools for /api/v2/health/risks/{id} operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_health_risk_data(path_id: str) -> Dict[str, Any]:
    '''
    Get health risk data.

    Args:
        path_id (str): The identifier for the health risk data path.

    Returns:
        Dict[str, Any]: The JSON response from the API call containing health risk data.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /api/v2/health/risks/{id}")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/api/v2/health/risks/{path_id}", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def update_health_risk_status(path_id: str, body_status: str = None) -> Dict[str, Any]:
    '''
    Update the status of a health risk.

    Args:
        path_id (str): The identifier for the health risk to be updated.
        body_status (str, optional): The new status to be set for the health risk. Defaults to None.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the updated health risk status.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making PUT request to /api/v2/health/risks/{id}")

    params = {}
    data = {}

    flat_body = {}
    if body_status is not None:
        flat_body["status"] = body_status
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/api/v2/health/risks/{path_id}", method="PUT", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response