"""Tools for /policies/{policy_id}/resolved-guardrails operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_resolved_get(path_policy_id: str) -> Any:
  """
    Get Resolved Guardrails

    OpenAPI Description:
        Get the resolved guardrails for a policy (including inherited guardrails).

This endpoint resolves the full inheritance chain and returns the final
set of guardrails that would be applied for this policy.

Example Request:
```bash
curl -X GET "http://localhost:4000/policies/123e4567-e89b-12d3-a456-426614174000/resolved-guardrails" \
    -H "Authorization: Bearer <litellm-api-key>"
```

Example Response:
```json
{
    "policy_id": "123e4567-e89b-12d3-a456-426614174000",
    "policy_name": "healthcare-compliance",
    "resolved_guardrails": ["pii_masking", "prompt_injection", "toxicity_filter"]
}
```

    Args:

        path_policy_id (str): OpenAPI parameter corresponding to 'path_policy_id'


    Returns:
        Any: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    """
  logger.debug("Making GET request to /policies/{policy_id}/resolved-guardrails")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/policies/{path_policy_id}/resolved-guardrails", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
