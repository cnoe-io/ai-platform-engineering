"""Tools for /api/v2/rbac/users/roles operations"""

import logging
from typing import Any, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def post_api_v2_rbac_users_roles(body_user_id: str, body_role_id: str, body_expiration: Optional[str] = None) -> Any:
  """
  Attach User to Role

  OpenAPI Description:
      Attach a user to a role

  Args:

      body_user_id (str): The ID of the user

      body_role_id (str): The ID of the role

      body_expiration (str): Optional expiration date for the user-role assignment


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /api/v2/rbac/users/roles")

  params = {}
  data = {}

  flat_body = {}
  if body_user_id is not None:
    flat_body["user_id"] = body_user_id
  if body_role_id is not None:
    flat_body["role_id"] = body_role_id
  if body_expiration is not None:
    flat_body["expiration"] = body_expiration
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/rbac/users/roles", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def put_api_v2_rbac_users_roles(body_user_id: str, body_role_id: str, body_expiration: str) -> Any:
  """
  Update User Role

  OpenAPI Description:
      Update a user role assignment

  Args:

      body_user_id (str): The ID of the user

      body_role_id (str): The ID of the role

      body_expiration (str): Optional expiration date for the user-role assignment


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making PUT request to /api/v2/rbac/users/roles")

  params = {}
  data = {}

  flat_body = {}
  if body_user_id is not None:
    flat_body["user_id"] = body_user_id
  if body_role_id is not None:
    flat_body["role_id"] = body_role_id
  if body_expiration is not None:
    flat_body["expiration"] = body_expiration
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/rbac/users/roles", method="PUT", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def del_api_v2_rbac_users_roles(body_user_id: str, body_role_id: str) -> Any:
  """
  Detach User from Role

  OpenAPI Description:
      Detach a user from a role

  Args:

      body_user_id (str): The ID of the user

      body_role_id (str): The ID of the role


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /api/v2/rbac/users/roles")

  params = {}
  data = {}

  flat_body = {}
  if body_user_id is not None:
    flat_body["user_id"] = body_user_id
  if body_role_id is not None:
    flat_body["role_id"] = body_role_id
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/rbac/users/roles", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
