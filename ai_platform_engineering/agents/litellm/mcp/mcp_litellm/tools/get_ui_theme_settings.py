"""Tools for /get/ui_theme_settings operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ui_get() -> Any:
  """
      Get Ui Theme Settings

      OpenAPI Description:
          Get UI theme configuration from the litellm_settings.
  Returns current logo settings for UI customization.

  Note: This endpoint is public (no authentication required) so all users can see custom branding.
  Only the /update/ui_theme_settings endpoint requires authentication for admins to change settings.

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /get/ui_theme_settings")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/get/ui_theme_settings", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
