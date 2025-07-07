"""Tools for /mgmt/v1/integrations/kubernetes/{clusterName} operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def cluster_controller_get_by_cluster_name(path_clusterName: str) -> Dict[str, Any]:
    """


    OpenAPI Description:


    Args:
    path_clusterName (str): OpenAPI parameter corresponding to 'path_clusterName'.


    Returns:
        Dict[str, Any]: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    """
    logger.debug("Making GET request to /mgmt/v1/integrations/kubernetes/{clusterName}")

    params = {}
    data = {}

    success, response = await make_api_request(
        f"/mgmt/v1/integrations/kubernetes/{path_clusterName}", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response
