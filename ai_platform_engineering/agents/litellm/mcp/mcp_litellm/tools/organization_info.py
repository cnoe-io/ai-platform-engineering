"""Tools for /organization/info operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_info_organization_get(param_organization_id: str) -> Any:
  """
  Info Organization

  OpenAPI Description:
      Get the org specific information

  Args:

      param_organization_id (str): OpenAPI parameter corresponding to 'param_organization_id'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /organization/info")

  params = {}
  data = {}

  if param_organization_id is not None:
    params["organization_id"] = str(param_organization_id).lower() if isinstance(param_organization_id, bool) else param_organization_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/organization/info", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
