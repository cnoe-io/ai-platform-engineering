"""Tools for /mgmt/v1/integrations/kubernetes/{clusterName} operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def cluster_controller_get_by_cluster_name(path_clusterName: str) -> Dict[str, Any]:
    '''
    Fetches the details of a Kubernetes cluster by its name.

    Args:
        path_clusterName (str): The name of the cluster to retrieve information for.

    Returns:
        Dict[str, Any]: A dictionary containing the JSON response from the API call, which includes details about the specified cluster.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making GET request to /mgmt/v1/integrations/kubernetes/{clusterName}")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/mgmt/v1/integrations/kubernetes/{path_clusterName}", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response