"""Tools for /project/info operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_project_info_project_info_get(param_project_id: str) -> Any:
  """
    Project Info

    OpenAPI Description:
        Get information about a specific project

Parameters:
- project_id: *str* - The project id to fetch info for

Example:
```bash
curl --location 'http://0.0.0.0:4000/project/info?project_id=project-123' \
--header 'Authorization: Bearer <litellm-api-key>'
```

    Args:

        param_project_id (str): OpenAPI parameter corresponding to 'param_project_id'


    Returns:
        Any: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    """
  logger.debug("Making GET request to /project/info")

  params = {}
  data = {}

  if param_project_id is not None:
    params["project_id"] = str(param_project_id).lower() if isinstance(param_project_id, bool) else param_project_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/project/info", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
