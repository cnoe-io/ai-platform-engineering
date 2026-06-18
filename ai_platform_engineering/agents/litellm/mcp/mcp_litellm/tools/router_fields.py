"""Tools for /router/fields operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_get_router_get() -> Any:
  """
      Get Router Fields

      OpenAPI Description:
          Get router settings field definitions without values.

  Returns only the field metadata (type, description, default, options) without
  populating field_value. This is useful for UI components that need to know
  what fields to render, but will get the actual values from a different endpoint.

  Returns:
  - fields: List of all configurable router settings with their metadata (type, description, default, options)
            The routing_strategy field includes available options extracted from the Router class
            Note: field_value will be None for all fields
  - routing_strategy_descriptions: Descriptions for each routing strategy option

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /router/fields")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/router/fields", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
