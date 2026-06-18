"""Tools for /policies/list operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_policies_policies_ls_get(param_version_status: str | None = None) -> Any:
  """
    List Policies

    OpenAPI Description:
        List all policies from the database. Optionally filter by version_status.

Query params:
- version_status: Optional. One of "draft", "published", "production".
  If omitted, all versions are returned.

Example Request:
```bash
curl -X GET "http://localhost:4000/policies/list" \
    -H "Authorization: Bearer <litellm-api-key>"
curl -X GET "http://localhost:4000/policies/list?version_status=production" \
    -H "Authorization: Bearer <litellm-api-key>"
```

Example Response:
```json
{
    "policies": [
        {
            "policy_id": "123e4567-e89b-12d3-a456-426614174000",
            "policy_name": "global-baseline",
            "version_number": 1,
            "version_status": "production",
            "inherit": null,
            "description": "Base guardrails for all requests",
            "guardrails_add": ["pii_masking"],
            "guardrails_remove": [],
            "condition": null,
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z"
        }
    ],
    "total_count": 1
}
```

    Args:

        param_version_status (str): OpenAPI parameter corresponding to 'param_version_status'


    Returns:
        Any: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    """
  logger.debug("Making GET request to /policies/list")

  params = {}
  data = {}

  if param_version_status is not None:
    params["version_status"] = str(param_version_status).lower() if isinstance(param_version_status, bool) else param_version_status

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/policies/list", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
