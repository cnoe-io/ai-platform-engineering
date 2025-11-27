"""Tools for /mgmt/v1/rbac/actions/{id} operations"""

import logging
from typing import Dict, Any, List, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def del_actions_controller_v1_del(path_id: str) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/custom-k8s-actions/{id}` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/custom-k8s-actions/{id}` API instead for new implementations and better validation and error handling.

  Args:

      path_id (str): uuid of the action


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /mgmt/v1/rbac/actions/{id}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/mgmt/v1/rbac/actions/{path_id}", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def put_actions_controller_v1_upd(path_id: str, body_description: str, body_k8s_ruleset: List[Dict[str, Any]]) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/custom-k8s-actions/{id}` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/custom-k8s-actions/{id}` API instead for new implementations and better validation and error handling.

  Args:

      path_id (str): uuid of a policy

      body_description (str): OpenAPI parameter corresponding to 'body_description'

      body_k8s_ruleset (List[Dict[str, Any]]): OpenAPI parameter corresponding to 'body_k8s_ruleset'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making PUT request to /mgmt/v1/rbac/actions/{id}")

  params = {}
  data = {}

  flat_body = {}
  if body_description is not None:
    flat_body["description"] = body_description
  if body_k8s_ruleset is not None:
    flat_body["k8s_ruleset"] = body_k8s_ruleset
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/mgmt/v1/rbac/actions/{path_id}", method="PUT", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
