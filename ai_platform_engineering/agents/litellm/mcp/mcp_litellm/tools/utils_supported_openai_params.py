"""Tools for /utils/supported_openai_params operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_supported_openai_get(param_model: str) -> Any:
  """
      Supported Openai Params

      OpenAPI Description:
          Returns supported openai params for a given litellm model name

  e.g. `gpt-4` vs `gpt-3.5-turbo`

  Example curl:
  ```
  curl -X GET --location 'http://localhost:4000/utils/supported_openai_params?model=gpt-3.5-turbo-16k'         --header 'Authorization: Bearer sk-1234'
  ```

      Args:

          param_model (str): OpenAPI parameter corresponding to 'param_model'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /utils/supported_openai_params")

  params = {}
  data = {}

  if param_model is not None:
    params["model"] = str(param_model).lower() if isinstance(param_model, bool) else param_model

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/utils/supported_openai_params", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
