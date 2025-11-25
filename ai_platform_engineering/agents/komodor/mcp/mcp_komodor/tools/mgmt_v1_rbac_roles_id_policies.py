"""Tools for /mgmt/v1/rbac/roles/{id}/policies operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_rbac_role_get(path_id: str) -> Any:
  """
  Deprecated: This is now part of `/api/v2/rbac/roles/{id_or_name}` response.

  OpenAPI Description:
      This API is deprecated. Role policies are now returned as part of the `/api/v2/rbac/roles/{id_or_name}` API response for better data consistency and reduced API calls.

  Args:

      path_id (str): uuid of a role


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /mgmt/v1/rbac/roles/{id}/policies")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/mgmt/v1/rbac/roles/{path_id}/policies", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
