"""Tools for /prompts/{prompt_id}/versions operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_prompt_get(path_prompt_id: str, param_environment: str | None = None) -> Any:
  """
    Get Prompt Versions

    OpenAPI Description:
        Get all versions of a specific prompt by base prompt ID

👉 [Prompt docs](https://docs.litellm.ai/docs/proxy/prompt_management)

Example Request:
```bash
curl -X GET "http://localhost:4000/prompts/jack_success/versions" \
    -H "Authorization: Bearer <litellm-api-key>"
```

Example Response:
```json
{
    "prompts": [
        {
            "prompt_id": "jack_success.v1",
            "litellm_params": {...},
            "prompt_info": {"prompt_type": "db"},
            "created_at": "2023-11-09T12:34:56.789Z",
            "updated_at": "2023-11-09T12:34:56.789Z"
        },
        {
            "prompt_id": "jack_success.v2",
            "litellm_params": {...},
            "prompt_info": {"prompt_type": "db"},
            "created_at": "2023-11-09T13:45:12.345Z",
            "updated_at": "2023-11-09T13:45:12.345Z"
        }
    ]
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
  logger.debug("Making GET request to /prompts/{prompt_id}/versions")

  params = {}
  data = {}

  if param_environment is not None:
    params["environment"] = str(param_environment).lower() if isinstance(param_environment, bool) else param_environment

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/prompts/{path_prompt_id}/versions", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
