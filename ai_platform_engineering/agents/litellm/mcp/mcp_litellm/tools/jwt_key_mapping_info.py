"""Tools for /jwt/key/mapping/info operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_info_jwt_get(param_id: str) -> Any:
  """
  Info Jwt Key Mapping

  OpenAPI Description:


  Args:

      param_id (str): OpenAPI parameter corresponding to 'param_id'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /jwt/key/mapping/info")

  params = {}
  data = {}

  if param_id is not None:
    params["id"] = str(param_id).lower() if isinstance(param_id, bool) else param_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/jwt/key/mapping/info", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
