"""Tools for /prompts/list operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_prompts_prompts_ls_get(param_environment: str | None = None) -> Any:
  """
      List Prompts

      OpenAPI Description:
          List the prompts that are available on the proxy server

  👉 [Prompt docs](https://docs.litellm.ai/docs/proxy/prompt_management)

  Example Request:
  ```bash
  curl -X GET "http://localhost:4000/prompts/list" -H "Authorization: Bearer <your_api_key>"
  ```

  Example Response:
  ```json
  {
      "prompts": [
          {
              "prompt_id": "my_prompt_id",
              "litellm_params": {
                  "prompt_id": "my_prompt_id",
                  "prompt_integration": "dotprompt",
                  "prompt_directory": "/path/to/prompts"
              },
              "prompt_info": {
                  "prompt_type": "config"
              },
              "created_at": "2023-11-09T12:34:56.789Z",
              "updated_at": "2023-11-09T12:34:56.789Z"
          }
      ]
  }
  ```

      Args:

          param_environment (str): OpenAPI parameter corresponding to 'param_environment'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /prompts/list")

  params = {}
  data = {}

  if param_environment is not None:
    params["environment"] = str(param_environment).lower() if isinstance(param_environment, bool) else param_environment

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/prompts/list", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
