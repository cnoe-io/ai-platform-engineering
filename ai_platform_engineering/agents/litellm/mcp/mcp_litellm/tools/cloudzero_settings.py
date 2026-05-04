"""Tools for /cloudzero/settings operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_cloudzero_get() -> Any:
  """
      Get Cloudzero Settings

      OpenAPI Description:
          View current CloudZero settings.

  Returns the current CloudZero configuration with the API key masked for security.
  Only the first 4 and last 4 characters of the API key are shown.
  Returns null/empty values when settings are not configured (consistent with other settings endpoints).

  Only admin users can view CloudZero settings.

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /cloudzero/settings")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/cloudzero/settings", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
