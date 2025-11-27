"""Tools for /api/v2/rbac/actions/{id} operations"""

import logging
from typing import Dict, Any, List, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def put_api_v2_rbac_actions_id(
  path_id: str, body_action: Optional[str] = None, body_description: Optional[str] = None, body_k8s_ruleset: List[Dict[str, Any]] = None
) -> Any:
  """
  Update Custom K8s Action by ID

  OpenAPI Description:
      Update a specific custom Kubernetes action by its ID

  Args:

      path_id (str): The ID of the custom K8s action to update

      body_action (str): Name of the action

      body_description (str): Description of the action

      body_k8s_ruleset (List[Dict[str, Any]]): OpenAPI parameter corresponding to 'body_k8s_ruleset'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making PUT request to /api/v2/rbac/actions/{id}")

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

  success, response = await make_api_request(f"/api/v2/rbac/actions/{path_id}", method="PUT", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def del_api_v2_rbac_actions_id(path_id: str) -> Any:
  """
  Delete Custom K8s Action by ID

  OpenAPI Description:
      Delete a specific custom Kubernetes action by its ID

  Args:

      path_id (str): The ID of the custom K8s action to delete


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /api/v2/rbac/actions/{id}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/api/v2/rbac/actions/{path_id}", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
