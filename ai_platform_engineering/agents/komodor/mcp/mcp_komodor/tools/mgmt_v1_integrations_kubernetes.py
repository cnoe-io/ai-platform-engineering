"""Tools for /mgmt/v1/integrations/kubernetes operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def post_clust_controller_post(body_cluster_name: str) -> Any:
  """
  Deprecated: Use `/api/v2/integrations/kubernetes` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/integrations/kubernetes` API instead for new implementations and better validation and error handling.

  Args:

      body_cluster_name (str): The name of the cluster


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /mgmt/v1/integrations/kubernetes")

  params = {}
  data = {}

  flat_body = {}
  if body_cluster_name is not None:
    flat_body["cluster_name"] = body_cluster_name
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/integrations/kubernetes", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
