"""Tools for /mgmt/v1/rbac/roles/policies operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def post_rbac_role_post(body_role_id: str, body_policy_id: str) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/roles/policies` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/roles/policies` API instead for new implementations and better validation and error handling.

  Args:

      body_role_id (str): OpenAPI parameter corresponding to 'body_role_id'

      body_policy_id (str): OpenAPI parameter corresponding to 'body_policy_id'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /mgmt/v1/rbac/roles/policies")

  params = {}
  data = {}

  flat_body = {}
  if body_role_id is not None:
    flat_body["role_id"] = body_role_id
  if body_policy_id is not None:
    flat_body["policy_id"] = body_policy_id
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/rbac/roles/policies", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def del_rbac_role_del(body_role_id: str, body_policy_id: str) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/roles/policies` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/roles/policies` API instead for new implementations and better validation and error handling.

  Args:

      body_role_id (str): OpenAPI parameter corresponding to 'body_role_id'

      body_policy_id (str): OpenAPI parameter corresponding to 'body_policy_id'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /mgmt/v1/rbac/roles/policies")

  params = {}
  data = {}

  flat_body = {}
  if body_role_id is not None:
    flat_body["role_id"] = body_role_id
  if body_policy_id is not None:
    flat_body["policy_id"] = body_policy_id
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/rbac/roles/policies", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
