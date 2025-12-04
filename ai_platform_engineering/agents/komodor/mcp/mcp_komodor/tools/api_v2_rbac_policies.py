"""Tools for /api/v2/rbac/policies operations"""

import logging
from typing import Dict, Any, List, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_rbac_policies() -> Any:
  """
  Get All Policies

  OpenAPI Description:
      Get all policies for the account

  Args:


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/rbac/policies")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/rbac/policies", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def post_api_v2_rbac_policies(body_name: str, body_statements: List[Dict[str, Any]], body_description: Optional[str] = None) -> Any:
  """
  Create Policy

  OpenAPI Description:
      Create Policy

  Args:

      body_name (str): OpenAPI parameter corresponding to 'body_name'

      body_description (str): OpenAPI parameter corresponding to 'body_description'

      body_statements (List[Dict[str, Any]]): OpenAPI parameter corresponding to 'body_statements'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /api/v2/rbac/policies")

  params = {}
  data = {}

  flat_body = {}
  if body_name is not None:
    flat_body["name"] = body_name
  if body_statements is not None:
    flat_body["statements"] = body_statements
  if body_description is not None:
    flat_body["description"] = body_description
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/rbac/policies", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
