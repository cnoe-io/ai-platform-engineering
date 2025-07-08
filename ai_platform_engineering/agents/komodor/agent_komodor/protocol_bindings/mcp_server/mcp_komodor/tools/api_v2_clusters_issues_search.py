"""Tools for /api/v2/clusters/issues/search operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def post_api_v2_clusters_issues_search(body: str) -> Dict[str, Any]:
    '''
    Search for issues in cluster scope.

    Search for issues based on the provided criteria. Maximum time range is 2 days. If no time range is provided, the default is the last 24 hours. Maximum time back is 7 days.

    Args:
        body (str): The request body containing search criteria for issues.

    Returns:
        Dict[str, Any]: The JSON response from the API call containing the search results.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making POST request to /api/v2/clusters/issues/search")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        "/api/v2/clusters/issues/search", method="POST", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response