"""Tools for /config_overrides/hashicorp_vault operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_hashicorp_get() -> Any:
  """
      Get Hashicorp Vault Config

      OpenAPI Description:
          Get current Hashicorp Vault configuration.
  Returns decrypted values from DB, or falls back to current env vars.

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /config_overrides/hashicorp_vault")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/config_overrides/hashicorp_vault", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
