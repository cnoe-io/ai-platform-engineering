"""Tools for /config/pass_through_endpoint operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_get_pass_get(param_endpoint_id: str | None = None, param_team_id: str | None = None) -> Any:
  """
      Get Pass Through Endpoints

      OpenAPI Description:
          GET configured pass through endpoint.

  If no endpoint_id given, return all configured endpoints.

      Args:

          param_endpoint_id (str): OpenAPI parameter corresponding to 'param_endpoint_id'

          param_team_id (str): OpenAPI parameter corresponding to 'param_team_id'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /config/pass_through_endpoint")

  params = {}
  data = {}

  if param_endpoint_id is not None:
    params["endpoint_id"] = str(param_endpoint_id).lower() if isinstance(param_endpoint_id, bool) else param_endpoint_id

  if param_team_id is not None:
    params["team_id"] = str(param_team_id).lower() if isinstance(param_team_id, bool) else param_team_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/config/pass_through_endpoint", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
