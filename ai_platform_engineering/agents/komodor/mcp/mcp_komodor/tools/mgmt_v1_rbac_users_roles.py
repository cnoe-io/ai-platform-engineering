"""Tools for /mgmt/v1/rbac/users/roles operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def post_rbac_user_post(body_user_id: str, body_role_id: str, body_expiration: str) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/users/roles` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/users/roles` API instead for new implementations and better validation and error handling.

  Args:

      body_user_id (str): OpenAPI parameter corresponding to 'body_user_id'

      body_role_id (str): OpenAPI parameter corresponding to 'body_role_id'

      body_expiration (str): OpenAPI parameter corresponding to 'body_expiration'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /mgmt/v1/rbac/users/roles")

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

  success, response = await make_api_request("/mgmt/v1/rbac/users/roles", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def del_rbac_user_del(body_user_id: str, body_role_id: str, body_expiration: str) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/users/roles` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/users/roles` API instead for new implementations and better validation and error handling.

  Args:

      body_user_id (str): OpenAPI parameter corresponding to 'body_user_id'

      body_role_id (str): OpenAPI parameter corresponding to 'body_role_id'

      body_expiration (str): OpenAPI parameter corresponding to 'body_expiration'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /mgmt/v1/rbac/users/roles")

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

  success, response = await make_api_request("/mgmt/v1/rbac/users/roles", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
