"""Tools for /mgmt/v1/integrations/kubernetes/{clusterName} operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_clust_controller_name(path_clusterName: str) -> Any:
  """
  Deprecated: Use `/api/v2/integrations/kubernetes/{clusterName}` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/integrations/kubernetes/{clusterName}` API instead for new implementations and better validation and error handling.

  Args:

      path_clusterName (str): Name of the cluster


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /mgmt/v1/integrations/kubernetes/{clusterName}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/mgmt/v1/integrations/kubernetes/{path_clusterName}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
