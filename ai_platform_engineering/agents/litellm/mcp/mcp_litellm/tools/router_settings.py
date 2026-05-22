"""Tools for /router/settings operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_router_get() -> Any:
  """
      Get Router Settings

      OpenAPI Description:
          Get router configuration and available settings.

  Returns:
  - fields: List of all configurable router settings with their metadata (type, description, default, options)
            The routing_strategy field includes available options extracted from the Router class
  - current_values: Current values of router settings from config

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /router/settings")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/router/settings", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
