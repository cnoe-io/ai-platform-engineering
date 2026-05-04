"""Tools for /credentials/by_name/{credential_name} operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_credential_get(path_credential_name: str) -> Any:
  """
  Get Credential By Name

  OpenAPI Description:
      [BETA] endpoint. This might change unexpectedly.

  Args:

      path_credential_name (str): The credential name, percent-decoded; may contain slashes


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /credentials/by_name/{credential_name}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/credentials/by_name/{path_credential_name}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
