"""Tools for /policies/name/{policy_name}/versions operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_policy_get(path_policy_name: str) -> Any:
  """
  List Policy Versions

  OpenAPI Description:
      List all versions of a policy by name, ordered by version_number descending.

  Args:

      path_policy_name (str): OpenAPI parameter corresponding to 'path_policy_name'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /policies/name/{policy_name}/versions")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/policies/name/{path_policy_name}/versions", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
