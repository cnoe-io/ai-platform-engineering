"""Tools for /policies/compare operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_compare_policy_get(param_version_a: str, param_version_b: str) -> Any:
  """
  Compare Policy Versions

  OpenAPI Description:
      Compare two policy versions. Query params: version_a, version_b (policy version IDs).

  Args:

      param_version_a (str): OpenAPI parameter corresponding to 'param_version_a'

      param_version_b (str): OpenAPI parameter corresponding to 'param_version_b'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /policies/compare")

  params = {}
  data = {}

  if param_version_a is not None:
    params["version_a"] = str(param_version_a).lower() if isinstance(param_version_a, bool) else param_version_a

  if param_version_b is not None:
    params["version_b"] = str(param_version_b).lower() if isinstance(param_version_b, bool) else param_version_b

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/policies/compare", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
