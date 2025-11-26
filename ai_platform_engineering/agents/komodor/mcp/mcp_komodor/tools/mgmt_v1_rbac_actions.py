"""Tools for /mgmt/v1/rbac/actions operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_actions_controller_v1_get_all() -> Any:
  """
  Deprecated: Use `/api/v2/rbac/custom-k8s-actions` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/custom-k8s-actions` API instead for new implementations and better validation and error handling.

  Args:


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /mgmt/v1/rbac/actions")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/rbac/actions", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def post_actions_controller_v1_post(body_action: str, body_description: str, body_k8s_ruleset: List[Dict[str, Any]]) -> Any:
  """
  Deprecated: Use `/api/v2/rbac/custom-k8s-actions` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/rbac/custom-k8s-actions` API instead for new implementations and better validation and error handling.

  Args:

      body_action (str): OpenAPI parameter corresponding to 'body_action'

      body_description (str): OpenAPI parameter corresponding to 'body_description'

      body_k8s_ruleset (List[Dict[str, Any]]): OpenAPI parameter corresponding to 'body_k8s_ruleset'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /mgmt/v1/rbac/actions")

  params = {}
  data = {}

  flat_body = {}
  if body_action is not None:
    flat_body["action"] = body_action
  if body_description is not None:
    flat_body["description"] = body_description
  if body_k8s_ruleset is not None:
    flat_body["k8s_ruleset"] = body_k8s_ruleset
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/rbac/actions", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
