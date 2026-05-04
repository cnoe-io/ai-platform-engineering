"""Tools for /policy/info/{policy_name} operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_policy_get(path_policy_name: str) -> Any:
  """
      Get Policy Info

      OpenAPI Description:
          Get detailed information about a specific policy.

  Returns:
  - Policy configuration
  - Resolved guardrails (after inheritance)
  - Inheritance chain

      Args:

          path_policy_name (str): OpenAPI parameter corresponding to 'path_policy_name'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /policy/info/{policy_name}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/policy/info/{path_policy_name}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
