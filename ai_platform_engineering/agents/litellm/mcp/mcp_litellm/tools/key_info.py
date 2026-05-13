"""Tools for /key/info operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_info_key_fn_key_info_get(param_key: str | None = None) -> Any:
  """
      Info Key Fn

      OpenAPI Description:
          Retrieve information about a key.
  Parameters:
      key: Optional[str] = Query parameter representing the key in the request
      user_api_key_dict: UserAPIKeyAuth = Dependency representing the user's API key
  Returns:
      Dict containing the key and its associated information

  Example Curl:
  ```
  curl -X GET "http://0.0.0.0:4000/key/info?key=<litellm-api-key>" -H "Authorization: Bearer <litellm-api-key>"
  ```

  Example Curl - if no key is passed, it will use the Key Passed in Authorization Header
  ```
  curl -X GET "http://0.0.0.0:4000/key/info" -H "Authorization: Bearer <litellm-api-key>"
  ```

      Args:

          param_key (str): Key in the request parameters


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /key/info")

  params = {}
  data = {}

  if param_key is not None:
    params["key"] = str(param_key).lower() if isinstance(param_key, bool) else param_key

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/key/info", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
