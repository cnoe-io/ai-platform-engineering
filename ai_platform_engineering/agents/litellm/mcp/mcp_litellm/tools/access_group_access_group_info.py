"""Tools for /access_group/{access_group}/info operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_access_get(path_access_group: str) -> Any:
  """
    Get Access Group Info

    OpenAPI Description:
        Get information about a specific access group.

Example:
```bash
curl -X GET 'http://localhost:4000/access_group/production-models/info' \
  -H 'Authorization: Bearer sk-1234'
```

Parameters:
- access_group: str - The access group name (URL path parameter)

Returns:
- AccessGroupInfo with the access group details

Raises:
- HTTPException 404: If access group not found

    Args:
    
        path_access_group (str): OpenAPI parameter corresponding to 'path_access_group'
    

    Returns:
        Any: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    """
  logger.debug("Making GET request to /access_group/{access_group}/info")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/access_group/{path_access_group}/info", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
