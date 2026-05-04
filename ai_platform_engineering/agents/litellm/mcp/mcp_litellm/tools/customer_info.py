"""Tools for /customer/info operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_end_user_get(param_end_user_id: str) -> Any:
  """
      End User Info

      OpenAPI Description:
          Get information about an end-user. An `end_user` is a customer (external user) of the proxy.

  Parameters:
  - end_user_id (str, required): The unique identifier for the end-user

  Example curl:
  ```
  curl -X GET 'http://localhost:4000/customer/info?end_user_id=test-litellm-user-4'         -H 'Authorization: Bearer sk-1234'
  ```

      Args:

          param_end_user_id (str): End User ID in the request parameters


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /customer/info")

  params = {}
  data = {}

  if param_end_user_id is not None:
    params["end_user_id"] = str(param_end_user_id).lower() if isinstance(param_end_user_id, bool) else param_end_user_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/customer/info", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
