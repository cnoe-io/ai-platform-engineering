"""Tools for /mgmt/v1/rbac/policies/{id} operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_policies_controller_v1_get(path_id: str) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/policies/{id_or_name}` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/policies/{id_or_name}` API instead for new implementations and better validation and error handling.

  Args:

      path_id (str): uuid of a policy


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /mgmt/v1/rbac/policies/{id}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/mgmt/v1/rbac/policies/{path_id}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def put_policies_controller_policy(path_id: str, body_name: str, body_statements: List[Dict[str, Any]]) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/policies/{id_or_name}` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/policies/{id_or_name}` API instead for new implementations and better validation and error handling.

  Args:

      path_id (str): uuid of a policy

      body_name (str): OpenAPI parameter corresponding to 'body_name'

      body_statements (List[Dict[str, Any]]): OpenAPI parameter corresponding to 'body_statements'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making PUT request to /mgmt/v1/rbac/policies/{id}")

  params = {}
  data = {}

  flat_body = {}
  if body_name is not None:
    flat_body["name"] = body_name
  if body_statements is not None:
    flat_body["statements"] = body_statements
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/mgmt/v1/rbac/policies/{path_id}", method="PUT", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
