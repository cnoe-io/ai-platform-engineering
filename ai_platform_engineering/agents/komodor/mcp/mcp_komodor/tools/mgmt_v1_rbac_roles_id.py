"""Tools for /mgmt/v1/rbac/roles/{id} operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_roles_controller_v1_get(path_id: str) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/roles/{id_or_name}` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/roles/{id_or_name}` API instead for new implementations and better validation and error handling.

  Args:

      path_id (str): uuid of a role


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /mgmt/v1/rbac/roles/{id}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/mgmt/v1/rbac/roles/{path_id}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
