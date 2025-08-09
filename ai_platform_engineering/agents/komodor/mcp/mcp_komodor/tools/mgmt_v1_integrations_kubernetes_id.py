"""Tools for /mgmt/v1/integrations/kubernetes/{id} operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def cluster_controller_delete(path_id: str) -> Dict[str, Any]:
    '''
    Deletes a Kubernetes cluster integration using the specified apiKey.

    Args:
        path_id (str): The apiKey of the cluster to be deleted.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the result of the deletion operation.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making DELETE request to /mgmt/v1/integrations/kubernetes/{id}")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/mgmt/v1/integrations/kubernetes/{path_id}", method="DELETE", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response