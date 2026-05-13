"""Tools for /fallback/{model} operations"""

import logging
from typing import Any, Literal
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_fallback_get(path_model: str, param_fallback_type: Literal["general", "context_window", "content_policy"] = None) -> Any:
  """
      Get Fallback

      OpenAPI Description:
          Get fallback configuration for a specific model.

  **Parameters:**
  - `model`: The model name to get fallbacks for
  - `fallback_type`: Type of fallback to retrieve (query parameter)

  **Example:**
  ```
  GET /fallback/gpt-3.5-turbo?fallback_type=general
  ```

      Args:

          path_model (str): OpenAPI parameter corresponding to 'path_model'

          param_fallback_type (Literal['general', 'context_window', 'content_policy']): OpenAPI parameter corresponding to 'param_fallback_type'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /fallback/{model}")

  params = {}
  data = {}

  if param_fallback_type is not None:
    params["fallback_type"] = str(param_fallback_type).lower() if isinstance(param_fallback_type, bool) else param_fallback_type

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/fallback/{path_model}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
