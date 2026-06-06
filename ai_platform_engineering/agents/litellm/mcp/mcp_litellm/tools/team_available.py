"""Tools for /team/available operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_available_get(param_response_model: str | None = None) -> Any:
  """
  List Available Teams

  OpenAPI Description:


  Args:

      param_response_model (str): OpenAPI parameter corresponding to 'param_response_model'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /team/available")

  params = {}
  data = {}

  if param_response_model is not None:
    params["response_model"] = str(param_response_model).lower() if isinstance(param_response_model, bool) else param_response_model

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/team/available", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
