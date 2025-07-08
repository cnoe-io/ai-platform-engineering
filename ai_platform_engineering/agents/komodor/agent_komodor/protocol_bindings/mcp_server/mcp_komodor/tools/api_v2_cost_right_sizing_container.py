"""Tools for /api/v2/cost/right-sizing/container operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_cost_right_sizing_per_container(
    param_clusterName: str, param_namespace: str, param_serviceKind: str, param_serviceName: str
) -> Dict[str, Any]:
    '''
    Get cost right-sizing summary per container.

    Args:
        param_clusterName (str): The name of the cluster.
        param_namespace (str): The name of the namespace.
        param_serviceKind (str): The service kind (e.g., Deployment, StatefulSet, CronJob, etc.).
        param_serviceName (str): The service name.

    Returns:
        Dict[str, Any]: The JSON response from the API call containing the cost right-sizing summary.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /api/v2/cost/right-sizing/container")

    params = {}
    data = {}

    if param_clusterName is not None:
        params["clusterName"] = (
            str(param_clusterName).lower() if isinstance(param_clusterName, bool) else param_clusterName
        )

    if param_namespace is not None:
        params["namespace"] = str(param_namespace).lower() if isinstance(param_namespace, bool) else param_namespace

    if param_serviceKind is not None:
        params["serviceKind"] = (
            str(param_serviceKind).lower() if isinstance(param_serviceKind, bool) else param_serviceKind
        )

    if param_serviceName is not None:
        params["serviceName"] = (
            str(param_serviceName).lower() if isinstance(param_serviceName, bool) else param_serviceName
        )

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        "/api/v2/cost/right-sizing/container", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response