"""Tools for /team/permissions_list operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_team_member_get(param_team_id: str | None = None) -> Any:
  """
  Team Member Permissions

  OpenAPI Description:
      Get the team member permissions for a team

  Args:

      param_team_id (str): Team ID in the request parameters


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /team/permissions_list")

  params = {}
  data = {}

  if param_team_id is not None:
    params["team_id"] = str(param_team_id).lower() if isinstance(param_team_id, bool) else param_team_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/team/permissions_list", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
