"""Tools for /api/v2/rbac/roles/{id_or_name} operations"""

import logging
from typing import Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_api_name(path_id_or_name: str) -> Any:
  """
  Get Role by ID or Name

  OpenAPI Description:
      Get Role by ID or Name

  Args:

      path_id_or_name (str): role id or name


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/rbac/roles/{id_or_name}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/rbac/roles/{path_id_or_name}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def put_api_name(
  path_id_or_name: str,
  body_name: str = None,
  body_is_default: bool = None,
  body_policy_ids: List[str] = None,
  body_policy_names: List[str] = None,
) -> Any:
  """
  Update Role by ID or Name

  OpenAPI Description:
      Update Role by ID or Name

  Args:

      path_id_or_name (str): role id or name

      body_name (str): OpenAPI parameter corresponding to 'body_name'

      body_is_default (bool): OpenAPI parameter corresponding to 'body_is_default'

      body_policy_ids (List[str]): OpenAPI parameter corresponding to 'body_policy_ids'

      body_policy_names (List[str]): OpenAPI parameter corresponding to 'body_policy_names'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making PUT request to /api/v2/rbac/roles/{id_or_name}")

  params = {}
  data = {}

  flat_body = {}
  if body_name is not None:
    flat_body["name"] = body_name
  if body_is_default is not None:
    flat_body["is_default"] = body_is_default
  if body_policy_ids is not None:
    flat_body["policy_ids"] = body_policy_ids
  if body_policy_names is not None:
    flat_body["policy_names"] = body_policy_names
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/rbac/roles/{path_id_or_name}", method="PUT", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def del_api_name(path_id_or_name: str) -> Any:
  """
  Delete Role by ID or Name

  OpenAPI Description:
      Delete Role by ID or Name

  Args:

      path_id_or_name (str): role id or name


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /api/v2/rbac/roles/{id_or_name}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/rbac/roles/{path_id_or_name}", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
