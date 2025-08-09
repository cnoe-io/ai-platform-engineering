"""Tools for /api/v2/services/k8s-events/search operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def post_api_v2_services_k8s_events_search(body: str) -> Dict[str, Any]:
    '''
    Search for Kubernetes events within a service scope.

    This function performs a search for Kubernetes events based on the provided criteria. The maximum time range for the search is 2 days. If no time range is specified, the default search period is the last 24 hours. The maximum allowable time back for the search is 7 days.

    Args:
        body (str): The request body containing search criteria for Kubernetes events.

    Returns:
        Dict[str, Any]: A dictionary containing the JSON response from the API call, which includes the search results.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with details of the failure.
    '''
    logger.debug("Making POST request to /api/v2/services/k8s-events/search")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        "/api/v2/services/k8s-events/search", method="POST", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response