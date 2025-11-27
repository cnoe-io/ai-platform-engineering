"""Tools for /api/v2/users operations"""

import logging
from typing import Any, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_users(param_display_name: Optional[str] = None, param_email: Optional[str] = None, param_is_deleted: bool = False) -> Any:
  """
  Get Users

  OpenAPI Description:


  Args:

      param_display_name (str): OpenAPI parameter corresponding to 'param_display_name'

      param_email (str): OpenAPI parameter corresponding to 'param_email'

      param_is_deleted (bool): Filter either deleted or not deleted users. If not provided, all users will be returned.


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/users")

  params = {}
  data = {}

  if param_display_name is not None:
    params["display_name"] = str(param_display_name).lower() if isinstance(param_display_name, bool) else param_display_name

  if param_email is not None:
    params["email"] = str(param_email).lower() if isinstance(param_email, bool) else param_email

  if param_is_deleted is not None:
    params["is_deleted"] = str(param_is_deleted).lower() if isinstance(param_is_deleted, bool) else param_is_deleted

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/users", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def post_api_v2_users(body_display_name: str, body_email: str, body_restore_if_deleted: Optional[bool] = None) -> Any:
  """
  Create a User

  OpenAPI Description:


  Args:

      body_display_name (str): OpenAPI parameter corresponding to 'body_display_name'

      body_email (str): OpenAPI parameter corresponding to 'body_email'

      body_restore_if_deleted (bool): restore user if it was marked as deleted


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /api/v2/users")

  params = {}
  data = {}

  flat_body = {}
  if body_display_name is not None:
    flat_body["display_name"] = body_display_name
  if body_email is not None:
    flat_body["email"] = body_email
  if body_restore_if_deleted is not None:
    flat_body["restore_if_deleted"] = body_restore_if_deleted
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/users", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
