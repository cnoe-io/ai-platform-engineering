"""Tools for /user/info operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_user_info_user_info_get(param_user_id: str | None = None) -> Any:
  """
      User Info

      OpenAPI Description:
          [10/07/2024]
  Note: To get all users (+pagination), use `/user/list` endpoint.


  Use this to get user information. (user row + all user key info)

  Example request
  ```
  curl -X GET 'http://localhost:4000/user/info?user_id=krrish7%40berri.ai'     --header 'Authorization: Bearer sk-1234'
  ```

      Args:

          param_user_id (str): User ID in the request parameters


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /user/info")

  params = {}
  data = {}

  if param_user_id is not None:
    params["user_id"] = str(param_user_id).lower() if isinstance(param_user_id, bool) else param_user_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/user/info", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
