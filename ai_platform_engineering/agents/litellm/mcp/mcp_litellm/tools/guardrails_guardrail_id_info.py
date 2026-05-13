"""Tools for /guardrails/{guardrail_id}/info operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_get_guardrail_get(path_guardrail_id: str) -> Any:
  """
    Get Guardrail Info

    OpenAPI Description:
        Get detailed information about a specific guardrail by ID

👉 [Guardrail docs](https://docs.litellm.ai/docs/proxy/guardrails/quick_start)

Example Request:
```bash
curl -X GET "http://localhost:4000/guardrails/123e4567-e89b-12d3-a456-426614174000/info" \
    -H "Authorization: Bearer <litellm-api-key>"
```

Example Response:
```json
{
    "guardrail_id": "123e4567-e89b-12d3-a456-426614174000",
    "guardrail_name": "my-bedrock-guard",
    "litellm_params": {
        "guardrail": "bedrock",
        "mode": "pre_call",
        "guardrailIdentifier": "ff6ujrregl1q",
        "guardrailVersion": "DRAFT",
        "default_on": true
    },
    "guardrail_info": {
        "description": "Bedrock content moderation guardrail"
    },
    "created_at": "2023-11-09T12:34:56.789Z",
    "updated_at": "2023-11-09T12:34:56.789Z"
}
```

    Args:

        path_guardrail_id (str): OpenAPI parameter corresponding to 'path_guardrail_id'


    Returns:
        Any: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    """
  logger.debug("Making GET request to /guardrails/{guardrail_id}/info")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/guardrails/{path_guardrail_id}/info", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
