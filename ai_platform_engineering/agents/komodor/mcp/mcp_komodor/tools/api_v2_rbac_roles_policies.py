"""Tools for /api/v2/rbac/roles/policies operations"""

import logging
from typing import Any, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def post_api_policies(body_role_id: str, body_policy_id: str) -> Any:
  """
  Attach Policy to Role

  OpenAPI Description:
      Attach a policy to a role

  Args:

      body_role_id (str): The ID of the role

      body_policy_id (str): The ID of the policy to attach to the role


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /api/v2/rbac/roles/policies")

  params = {}
  data = {}

  flat_body = {}
  if body_role_id is not None:
    flat_body["role_id"] = body_role_id
  if body_policy_id is not None:
    flat_body["policy_id"] = body_policy_id
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/rbac/roles/policies", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def del_api_v2_rbac_roles_policies(body_role_id: str, body_policy_id: str) -> Any:
  """
  Detach Policy from Role

  OpenAPI Description:
      Detach a policy from a role

  Args:

      body_role_id (str): The ID of the role

      body_policy_id (str): The ID of the policy to detach from the role


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /api/v2/rbac/roles/policies")

  params = {}
  data = {}

  flat_body = {}
  if body_role_id is not None:
    flat_body["role_id"] = body_role_id
  if body_policy_id is not None:
    flat_body["policy_id"] = body_policy_id
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/rbac/roles/policies", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
