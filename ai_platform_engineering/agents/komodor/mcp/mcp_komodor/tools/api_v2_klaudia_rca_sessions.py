"""Tools for /api/v2/klaudia/rca/sessions operations"""

import logging
from typing import Dict, Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def trigger_klaudia_rca(
    body_kind: str, body_name: str, body_namespace: str, body_clusterName: str
) -> Dict[str, Any]:
    '''
    Trigger a new RCA investigation.

    Args:
        body_kind (str): The kind of the body for the RCA investigation.
        body_name (str): The name of the body for the RCA investigation.
        body_namespace (str): The namespace of the body for the RCA investigation.
        body_clusterName (str): The cluster name of the body for the RCA investigation.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the results of the RCA investigation.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making POST request to /api/v2/klaudia/rca/sessions")

    params = {}
    data = {}

    flat_body = {}
    if body_kind is not None:
        flat_body["kind"] = body_kind
    if body_name is not None:
        flat_body["name"] = body_name
    if body_namespace is not None:
        flat_body["namespace"] = body_namespace
    if body_clusterName is not None:
        flat_body["clusterName"] = body_clusterName
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/api/v2/klaudia/rca/sessions", method="POST", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response