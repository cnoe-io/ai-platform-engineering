"""Tools for /api/v2/integrations/kubernetes/{clusterName} operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_get_api_name(path_clusterName: str) -> Any:
  """
  Get Kubernetes Integration by Cluster Name

  OpenAPI Description:
      Get a specific Kubernetes integration by its cluster name

  Args:

      path_clusterName (str): The name of the Kubernetes cluster


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/integrations/kubernetes/{clusterName}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/integrations/kubernetes/{path_clusterName}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
