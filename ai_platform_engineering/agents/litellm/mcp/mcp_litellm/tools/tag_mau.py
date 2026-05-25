"""Tools for /tag/mau operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_monthly_get(param_tag_filter: str | None = None, param_tag_filters: str | None = None) -> Any:
  """
      Get Monthly Active Users

      OpenAPI Description:
          Get Monthly Active Users (MAU) by tags for the last {MAX_MONTHS} months ending on UTC today + 1 day.

  Shows month-by-month breakdown:
  - Month 1 (Nov): Earliest month (7 months ago, 30-day period)
  - Month 2 (Dec): Next month (6 months ago)
  - Month 3 (Jan): Next month (5 months ago)
  - ... and so on for {MAX_MONTHS} months total
  - Month 7: Most recent month ending on UTC today + 1 day

  Args:
      tag_filter: Optional filter to specific tag (legacy)
      tag_filters: Optional filter to multiple specific tags (takes precedence over tag_filter)

  Returns:
      ActiveUsersAnalyticsResponse: MAU data by tag for each of the last {MAX_MONTHS} months with descriptive month labels (e.g., "Month 1 (Nov)")

      Args:

          param_tag_filter (str): Filter by specific tag (optional)

          param_tag_filters (str): Filter by multiple specific tags (optional, takes precedence over tag_filter)


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /tag/mau")

  params = {}
  data = {}

  if param_tag_filter is not None:
    params["tag_filter"] = str(param_tag_filter).lower() if isinstance(param_tag_filter, bool) else param_tag_filter

  if param_tag_filters is not None:
    params["tag_filters"] = str(param_tag_filters).lower() if isinstance(param_tag_filters, bool) else param_tag_filters

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/tag/mau", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
