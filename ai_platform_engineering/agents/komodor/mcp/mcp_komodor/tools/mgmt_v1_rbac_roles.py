"""Tools for /mgmt/v1/rbac/roles operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_roles_controller_v1_get_all() -> Any:
  """
  Deprecated: Use `/api/v2/rbac/roles` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/roles` API instead for new implementations and better validation and error handling.

  Args:


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /mgmt/v1/rbac/roles")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/rbac/roles", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def post_roles_controller_v1_post(body_name: str) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/roles` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/roles` API instead for new implementations and better validation and error handling.

  Args:

      body_name (str): Role name


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /mgmt/v1/rbac/roles")

  params = {}
  data = {}

  flat_body = {}
  if body_name is not None:
    flat_body["name"] = body_name
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/rbac/roles", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def del_roles_controller_v1_del(body_id: str) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/roles/{id_or_name}` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/roles/{id_or_name}` API instead for new implementations and better validation and error handling.

  Args:

      body_id (str): Role id


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /mgmt/v1/rbac/roles")

  params = {}
  data = {}

  flat_body = {}
  if body_id is not None:
    flat_body["id"] = body_id
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/rbac/roles", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
