"""Tools for /api/v2/klaudia/rca/sessions/{id} operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_klaudia_rca_results(path_id: str) -> Dict[str, Any]:
    '''
    Retrieve RCA investigation results.

    Args:
        path_id (str): The identifier for the RCA session path.

    Returns:
        Dict[str, Any]: The JSON response from the API call containing RCA investigation results.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /api/v2/klaudia/rca/sessions/{id}")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/api/v2/klaudia/rca/sessions/{path_id}", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response