"""Tools for /customer/list operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_end_user_customer_ls_get() -> Any:
  """
      List End User

      OpenAPI Description:
          [Admin-only] List all available customers

  Example curl:
  ```
  curl --location --request GET 'http://0.0.0.0:4000/customer/list'         --header 'Authorization: Bearer <litellm-api-key>'
  ```

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /customer/list")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/customer/list", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
