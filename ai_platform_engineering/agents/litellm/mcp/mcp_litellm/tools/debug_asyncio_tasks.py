"""Tools for /debug/asyncio-tasks operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_active_get() -> Any:
  """
    Get Active Tasks Stats

    OpenAPI Description:
        Returns:
  total_active_tasks: int
  by_name: { coroutine_name: count }

    Args:


    Returns:
        Any: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /debug/asyncio-tasks")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/debug/asyncio-tasks", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
