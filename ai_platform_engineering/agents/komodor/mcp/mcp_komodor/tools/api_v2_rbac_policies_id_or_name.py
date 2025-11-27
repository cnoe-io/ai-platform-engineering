"""Tools for /api/v2/rbac/policies/{id_or_name} operations"""

import logging
from typing import Dict, Any, List, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_get_api_name(path_id_or_name: str) -> Any:
  """
  Get Policy by ID or Name

  OpenAPI Description:
      Get Policy by ID or Name

  Args:

      path_id_or_name (str): policy id or name


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/rbac/policies/{id_or_name}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/rbac/policies/{path_id_or_name}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def put_put_api_name(
  path_id_or_name: str, body_name: Optional[str] = None, body_description: Optional[str] = None, body_statements: List[Dict[str, Any]] = None
) -> Any:
  """
  Update Policy by Id or Name

  OpenAPI Description:
      Update Policy by Id or Name

  Args:

      path_id_or_name (str): policy id or name

      body_name (str): OpenAPI parameter corresponding to 'body_name'

      body_description (str): OpenAPI parameter corresponding to 'body_description'

      body_statements (List[Dict[str, Any]]): OpenAPI parameter corresponding to 'body_statements'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making PUT request to /api/v2/rbac/policies/{id_or_name}")

  params = {}
  data = {}

  flat_body = {}
  if body_name is not None:
    flat_body["name"] = body_name
  if body_description is not None:
    flat_body["description"] = body_description
  if body_statements is not None:
    flat_body["statements"] = body_statements
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/rbac/policies/{path_id_or_name}", method="PUT", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def del_del_api_name(path_id_or_name: str) -> Any:
  """
  Delete Policy by Id or Name

  OpenAPI Description:
      Delete Policy by Id or Name

  Args:

      path_id_or_name (str): policy id or name


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /api/v2/rbac/policies/{id_or_name}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/rbac/policies/{path_id_or_name}", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
