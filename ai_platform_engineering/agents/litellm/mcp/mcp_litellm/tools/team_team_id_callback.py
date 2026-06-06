"""Tools for /team/{team_id}/callback operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_get_team_get(path_team_id: str) -> Any:
  """
      Get Team Callbacks

      OpenAPI Description:
          Get the success/failure callbacks and variables for a team

  Parameters:
  - team_id (str, required): The unique identifier for the team

  Example curl:
  ```
  curl -X GET 'http://localhost:4000/team/dbe2f686-a686-4896-864a-4c3924458709/callback'         -H 'Authorization: Bearer <litellm-api-key>'
  ```

  This will return the callback settings for the team with id dbe2f686-a686-4896-864a-4c3924458709

  Returns {
          "status": "success",
          "data": {
              "team_id": team_id,
              "success_callbacks": team_callback_settings_obj.success_callback,
              "failure_callbacks": team_callback_settings_obj.failure_callback,
              "callback_vars": team_callback_settings_obj.callback_vars,
          },
      }

      Args:

          path_team_id (str): OpenAPI parameter corresponding to 'path_team_id'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /team/{team_id}/callback")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/team/{path_team_id}/callback", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
