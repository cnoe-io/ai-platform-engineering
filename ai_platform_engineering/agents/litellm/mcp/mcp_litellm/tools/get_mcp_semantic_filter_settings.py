"""Tools for /get/mcp_semantic_filter_settings operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_mcp_get() -> Any:
  """
      Get Mcp Semantic Filter Settings

      OpenAPI Description:
          Get MCP semantic filter configuration.
  Returns current settings for semantic tool filtering.

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /get/mcp_semantic_filter_settings")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/get/mcp_semantic_filter_settings", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
