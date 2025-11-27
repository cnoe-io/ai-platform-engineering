"""Tools for /mgmt/v1/rbac/policies operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_policies_controller_v1_get_all() -> Any:
  """
  Deprecated: Use `/api/v2/rbac/policies` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/policies` API instead for new implementations and better validation and error handling.

  Args:


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /mgmt/v1/rbac/policies")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/rbac/policies", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def post_policies_controller_v1_post(body_name: str, body_statements: List[Dict[str, Any]]) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/policies` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/policies` API instead for new implementations and better validation and error handling.

  Args:

      body_name (str): OpenAPI parameter corresponding to 'body_name'

      body_statements (List[Dict[str, Any]]): OpenAPI parameter corresponding to 'body_statements'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /mgmt/v1/rbac/policies")

  params = {}
  data = {}

  flat_body = {}
  if body_name is not None:
    flat_body["name"] = body_name
  if body_statements is not None:
    flat_body["statements"] = body_statements
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/rbac/policies", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def del_policies_controller_v1_del(body_id: str) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/policies/{id_or_name}` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/policies/{id_or_name}` API instead for new implementations and better validation and error handling.

  Args:

      body_id (str): Policy id


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /mgmt/v1/rbac/policies")

  params = {}
  data = {}

  flat_body = {}
  if body_id is not None:
    flat_body["id"] = body_id
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/rbac/policies", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
