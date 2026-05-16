"""Tools for /get/sso_settings operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_sso_get() -> Any:
  """
      Get Sso Settings

      OpenAPI Description:
          Get all SSO configuration settings from the dedicated SSO table.
  Returns a structured object with values and descriptions for UI display.

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /get/sso_settings")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/get/sso_settings", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
