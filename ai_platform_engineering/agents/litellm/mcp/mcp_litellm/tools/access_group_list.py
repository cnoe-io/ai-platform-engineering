"""Tools for /access_group/list operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_access_get() -> Any:
  """
    List Access Groups

    OpenAPI Description:
        List all access groups.

Returns a list of all access groups with their model names and deployment counts.

Example:
```bash
curl -X GET 'http://localhost:4000/access_group/list' \
  -H 'Authorization: Bearer sk-1234'
```

Returns:
- ListAccessGroupsResponse with all access groups

    Args:
    

    Returns:
        Any: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    """
  logger.debug("Making GET request to /access_group/list")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/access_group/list", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
