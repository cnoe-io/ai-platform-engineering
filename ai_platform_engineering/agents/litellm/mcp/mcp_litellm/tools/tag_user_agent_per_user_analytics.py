"""Tools for /tag/user-agent/per-user-analytics operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_per_get(
  param_tag_filter: str | None = None, param_tag_filters: str | None = None, param_page: int | None = None, param_page_size: int | None = None
) -> Any:
  """
      Get Per User Analytics

      OpenAPI Description:
          Get per-user analytics including successful requests, tokens, and spend by individual users.

  This endpoint provides usage metrics broken down by individual users based on their
  tag activity during the last 30 days ending on UTC today + 1 day.

  Args:
      tag_filter: Optional filter to specific tag (legacy)
      tag_filters: Optional filter to multiple specific tags (takes precedence over tag_filter)
      page: Page number for pagination
      page_size: Number of items per page

  Returns:
      PerUserAnalyticsResponse: Analytics data broken down by individual users for the last 30 days

      Args:

          param_tag_filter (str): Filter by specific tag (optional)

          param_tag_filters (str): Filter by multiple specific tags (optional, takes precedence over tag_filter)

          param_page (int): Page number for pagination

          param_page_size (int): Items per page


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /tag/user-agent/per-user-analytics")

  params = {}
  data = {}

  if param_tag_filter is not None:
    params["tag_filter"] = str(param_tag_filter).lower() if isinstance(param_tag_filter, bool) else param_tag_filter

  if param_tag_filters is not None:
    params["tag_filters"] = str(param_tag_filters).lower() if isinstance(param_tag_filters, bool) else param_tag_filters

  if param_page is not None:
    params["page"] = str(param_page).lower() if isinstance(param_page, bool) else param_page

  if param_page_size is not None:
    params["page_size"] = str(param_page_size).lower() if isinstance(param_page_size, bool) else param_page_size

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/tag/user-agent/per-user-analytics", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
