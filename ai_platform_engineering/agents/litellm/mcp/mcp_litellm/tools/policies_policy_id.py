"""Tools for /policies/{policy_id} operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_get_policy_get(path_policy_id: str) -> Any:
  """
    Get Policy

    OpenAPI Description:
        Get a policy by ID.

Example Request:
```bash
curl -X GET "http://localhost:4000/policies/123e4567-e89b-12d3-a456-426614174000" \
    -H "Authorization: Bearer <litellm-api-key>"
```

    Args:

        path_policy_id (str): OpenAPI parameter corresponding to 'path_policy_id'


    Returns:
        Any: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    """
  logger.debug("Making GET request to /policies/{policy_id}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/policies/{path_policy_id}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
