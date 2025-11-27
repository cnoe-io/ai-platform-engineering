"""Tools for /mgmt/v1/apikey/validate operations"""

import logging
from typing import Any, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_api_keys_controller_validate() -> Any:
  """
  Deprecated: Use `/api/v2/apikey/validate` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/apikey/validate` API instead for new implementations and better validation and error handling.

  Args:


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /mgmt/v1/apikey/validate")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/apikey/validate", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
