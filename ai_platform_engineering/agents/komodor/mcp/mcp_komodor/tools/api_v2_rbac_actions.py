"""Tools for /api/v2/rbac/actions operations"""

import logging
from typing import Dict, Any, List, Literal
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_rbac_actions(
  param_account_id: str = None,
  param_actions: List[str] = None,
  param_scoping_methods: List[str] = None,
  param_limit: int = None,
  param_offset: int = None,
  param_sort: Literal["ASC", "DESC"] = None,
) -> Any:
  """
  Get Custom K8s Actions

  OpenAPI Description:
      Get custom Kubernetes actions for the account

  Args:

      param_account_id (str): Filter by account ID

      param_actions (List[str]): Filter by specific action names

      param_scoping_methods (List[str]): Filter by scoping methods

      param_limit (int): Maximum number of items to return

      param_offset (int): Number of items to skip

      param_sort (Literal['ASC', 'DESC']): if no sort order was specified, the order will be random from the database


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/rbac/actions")

  params = {}
  data = {}

  if param_account_id is not None:
    params["account_id"] = str(param_account_id).lower() if isinstance(param_account_id, bool) else param_account_id

  if param_actions is not None:
    params["actions"] = str(param_actions).lower() if isinstance(param_actions, bool) else param_actions

  if param_scoping_methods is not None:
    params["scoping_methods"] = str(param_scoping_methods).lower() if isinstance(param_scoping_methods, bool) else param_scoping_methods

  if param_limit is not None:
    params["limit"] = str(param_limit).lower() if isinstance(param_limit, bool) else param_limit

  if param_offset is not None:
    params["offset"] = str(param_offset).lower() if isinstance(param_offset, bool) else param_offset

  if param_sort is not None:
    params["sort"] = str(param_sort).lower() if isinstance(param_sort, bool) else param_sort

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/rbac/actions", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def post_api_v2_rbac_actions(body_action: str, body_k8s_ruleset: List[Dict[str, Any]], body_description: str = None) -> Any:
  """
  Create Custom K8s Action

  OpenAPI Description:
      Create a new custom Kubernetes action

  Args:

      body_action (str): Name of the action

      body_description (str): Description of the action

      body_k8s_ruleset (List[Dict[str, Any]]): OpenAPI parameter corresponding to 'body_k8s_ruleset'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /api/v2/rbac/actions")

  params = {}
  data = {}

  flat_body = {}
  if body_action is not None:
    flat_body["action"] = body_action
  if body_k8s_ruleset is not None:
    flat_body["k8s_ruleset"] = body_k8s_ruleset
  if body_description is not None:
    flat_body["description"] = body_description
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/rbac/actions", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
