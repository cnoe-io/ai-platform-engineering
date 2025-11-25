"""Tools for /api/v2/users/{id_or_email} operations"""

import logging
from typing import Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_users_id_or_email(path_id_or_email: str) -> Any:
  """
  Get a User by id or email

  OpenAPI Description:


  Args:

      path_id_or_email (str): user id or email


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/users/{id_or_email}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/users/{path_id_or_email}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def put_api_v2_users_id_or_email(
  path_id_or_email: str, body_display_name: str = None, body_role_ids: List[str] = None, body_role_names: List[str] = None
) -> Any:
  """
  Update a User by id or email

  OpenAPI Description:


  Args:

      path_id_or_email (str): user id or email

      body_display_name (str): OpenAPI parameter corresponding to 'body_display_name'

      body_role_ids (List[str]): OpenAPI parameter corresponding to 'body_role_ids'

      body_role_names (List[str]): OpenAPI parameter corresponding to 'body_role_names'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making PUT request to /api/v2/users/{id_or_email}")

  params = {}
  data = {}

  flat_body = {}
  if body_display_name is not None:
    flat_body["display_name"] = body_display_name
  if body_role_ids is not None:
    flat_body["role_ids"] = body_role_ids
  if body_role_names is not None:
    flat_body["role_names"] = body_role_names
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/users/{path_id_or_email}", method="PUT", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def del_api_v2_users_id_or_email(path_id_or_email: str) -> Any:
  """
  Delete a User by id or email

  OpenAPI Description:


  Args:

      path_id_or_email (str): user id or email


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /api/v2/users/{id_or_email}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/users/{path_id_or_email}", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
