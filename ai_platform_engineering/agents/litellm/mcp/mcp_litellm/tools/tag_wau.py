"""Tools for /tag/wau operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_weekly_get(param_tag_filter: str | None = None, param_tag_filters: str | None = None) -> Any:
  """
      Get Weekly Active Users

      OpenAPI Description:
          Get Weekly Active Users (WAU) by tags for the last {MAX_WEEKS} weeks ending on UTC today + 1 day.

  Shows week-by-week breakdown:
  - Week 1 (Jan 1): Earliest week (7 weeks ago)
  - Week 2 (Jan 8): Next week (6 weeks ago)
  - Week 3 (Jan 15): Next week (5 weeks ago)
  - ... and so on for {MAX_WEEKS} weeks total
  - Week 7: Most recent week ending on UTC today + 1 day

  Args:
      tag_filter: Optional filter to specific tag (legacy)
      tag_filters: Optional filter to multiple specific tags (takes precedence over tag_filter)

  Returns:
      ActiveUsersAnalyticsResponse: WAU data by tag for each of the last {MAX_WEEKS} weeks with descriptive week labels (e.g., "Week 1 (Jan 1)")

      Args:

          param_tag_filter (str): Filter by specific tag (optional)

          param_tag_filters (str): Filter by multiple specific tags (optional, takes precedence over tag_filter)


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /tag/wau")

  params = {}
  data = {}

  if param_tag_filter is not None:
    params["tag_filter"] = str(param_tag_filter).lower() if isinstance(param_tag_filter, bool) else param_tag_filter

  if param_tag_filters is not None:
    params["tag_filters"] = str(param_tag_filters).lower() if isinstance(param_tag_filters, bool) else param_tag_filters

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/tag/wau", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
