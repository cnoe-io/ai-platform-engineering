"""Tools for /api/v2/rbac/actions/{action} operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_rbac_actions_action(path_action: str) -> Any:
  """
  Get Custom K8s Action by Action Name

  OpenAPI Description:
      Get a specific custom Kubernetes action by its action name

  Args:

      path_action (str): The name of the custom K8s action to retrieve


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/rbac/actions/{action}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/rbac/actions/{path_action}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
