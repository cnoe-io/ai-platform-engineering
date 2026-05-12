"""Tools for /config/pass_through_endpoint/team/{team_id} operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_pass_get(path_team_id: str, param_endpoint_id: str | None = None) -> Any:
  """
      Get Pass Through Endpoints

      OpenAPI Description:
          GET configured pass through endpoint.

  If no endpoint_id given, return all configured endpoints.

      Args:

          path_team_id (str): OpenAPI parameter corresponding to 'path_team_id'

          param_endpoint_id (str): OpenAPI parameter corresponding to 'param_endpoint_id'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /config/pass_through_endpoint/team/{team_id}")

  params = {}
  data = {}

  if param_endpoint_id is not None:
    params["endpoint_id"] = str(param_endpoint_id).lower() if isinstance(param_endpoint_id, bool) else param_endpoint_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/config/pass_through_endpoint/team/{path_team_id}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
