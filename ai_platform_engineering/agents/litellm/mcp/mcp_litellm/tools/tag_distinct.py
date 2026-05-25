"""Tools for /tag/distinct operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_distinct_get() -> Any:
  """
      Get Distinct User Agent Tags

      OpenAPI Description:
          Get all distinct user agent tags up to a maximum of {MAX_TAGS} tags.

  This endpoint returns all unique user agent tags found in the database,
  sorted by frequency of usage.

  Returns:
      DistinctTagsResponse: List of distinct user agent tags

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /tag/distinct")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/tag/distinct", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
