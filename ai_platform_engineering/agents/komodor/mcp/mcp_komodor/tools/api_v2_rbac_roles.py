"""Tools for /api/v2/rbac/roles operations"""

import logging
from typing import Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_rbac_roles() -> Any:
  """
  Get All Roles

  OpenAPI Description:
      Get all roles for the account

  Args:


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/rbac/roles")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/rbac/roles", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def post_api_v2_rbac_roles(body_name: str, body_is_default: bool = None, body_policy_ids: List[str] = None) -> Any:
  """
  Create Role

  OpenAPI Description:
      Create a new role

  Args:

      body_name (str): Role name

      body_is_default (bool): Whether this role should be the default role

      body_policy_ids (List[str]): List of policy IDs to assign to this role


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /api/v2/rbac/roles")

  params = {}
  data = {}

  flat_body = {}
  if body_name is not None:
    flat_body["name"] = body_name
  if body_is_default is not None:
    flat_body["is_default"] = body_is_default
  if body_policy_ids is not None:
    flat_body["policy_ids"] = body_policy_ids
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/rbac/roles", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
