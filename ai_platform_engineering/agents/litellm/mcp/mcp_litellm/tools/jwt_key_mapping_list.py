"""Tools for /jwt/key/mapping/list operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_jwt_get(param_page: int | None = None, param_size: int | None = None) -> Any:
  """
  List Jwt Key Mappings

  OpenAPI Description:


  Args:

      param_page (int): Page number

      param_size (int): Page size


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /jwt/key/mapping/list")

  params = {}
  data = {}

  if param_page is not None:
    params["page"] = str(param_page).lower() if isinstance(param_page, bool) else param_page

  if param_size is not None:
    params["size"] = str(param_size).lower() if isinstance(param_size, bool) else param_size

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/jwt/key/mapping/list", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
