"""Tools for /prompts/{prompt_id}/info operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_get_prompt_get(path_prompt_id: str, param_environment: str | None = None) -> Any:
  """
    Get Prompt Info

    OpenAPI Description:
        Get detailed information about a specific prompt by ID, including prompt content

    👉 [Prompt docs](https://docs.litellm.ai/docs/proxy/prompt_management)

    Example Request:
    ```bash
    curl -X GET "http://localhost:4000/prompts/my_prompt_id/info" \
        -H "Authorization: Bearer <your_api_key>"
    ```

    Example Response:
    ```json
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
        "updated_at": "2023-11-09T12:34:56.789Z",
        "content": "System: You are a helpful assistant.

User: {{user_message}}"
    }
    ```

    Args:
    
        path_prompt_id (str): OpenAPI parameter corresponding to 'path_prompt_id'
    
        param_environment (str): OpenAPI parameter corresponding to 'param_environment'
    

    Returns:
        Any: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    """
  logger.debug("Making GET request to /prompts/{prompt_id}/info")

  params = {}
  data = {}

  if param_environment is not None:
    params["environment"] = str(param_environment).lower() if isinstance(param_environment, bool) else param_environment

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/prompts/{path_prompt_id}/info", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
