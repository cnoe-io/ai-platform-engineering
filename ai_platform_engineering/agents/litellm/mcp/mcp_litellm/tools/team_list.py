"""Tools for /team/list operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_team_team_ls_get(param_user_id: str | None = None, param_organization_id: str | None = None) -> Any:
  """
      List Team

      OpenAPI Description:
          ```
  curl --location --request GET 'http://0.0.0.0:4000/team/list'         --header 'Authorization: Bearer sk-1234'
  ```

  Parameters:
  - user_id: str - Optional. If passed will only return teams that the user_id is a member of.
  - organization_id: str - Optional. If passed will only return teams that belong to the organization_id. Pass 'default_organization' to get all teams without organization_id.

      Args:

          param_user_id (str): Only return teams which this 'user_id' belongs to

          param_organization_id (str): OpenAPI parameter corresponding to 'param_organization_id'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /team/list")

  params = {}
  data = {}

  if param_user_id is not None:
    params["user_id"] = str(param_user_id).lower() if isinstance(param_user_id, bool) else param_user_id

  if param_organization_id is not None:
    params["organization_id"] = str(param_organization_id).lower() if isinstance(param_organization_id, bool) else param_organization_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/team/list", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
