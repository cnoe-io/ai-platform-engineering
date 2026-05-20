"""Tools for /public/endpoints operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_get_supported_get() -> Any:
  """
      Get Supported Endpoints

      OpenAPI Description:
          Return the list of LiteLLM proxy endpoints and which providers support each one.

  Reads from the bundled local backup file. Result is cached in-process for
  the lifetime of the server process.

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /public/endpoints")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/public/endpoints", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
