"""Tools for /api/v2/integrations/kubernetes operations"""

import logging
from typing import Any, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def post_api_kubernetes(body_cluster_name: str) -> Any:
  """
  Create Kubernetes Integration

  OpenAPI Description:
      Create a new Kubernetes cluster integration

  Args:

      body_cluster_name (str): The name of the Kubernetes cluster


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /api/v2/integrations/kubernetes")

  params = {}
  data = {}

  flat_body = {}
  if body_cluster_name is not None:
    flat_body["cluster_name"] = body_cluster_name
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/integrations/kubernetes", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
