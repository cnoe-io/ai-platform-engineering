"""Tools for /mgmt/v1/rbac/actions/{action} operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_actions_controller_v1_get(path_action: str) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/custom-k8s-actions` with actions parameter instead.

  OpenAPI Description:
      This API is deprecated. You can fetch specific actions from `/api/v2/rbac/custom-k8s-actions` with the actions query parameter for better filtering and performance.

  Args:

      path_action (str): Name of an action


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /mgmt/v1/rbac/actions/{action}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/mgmt/v1/rbac/actions/{path_action}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
