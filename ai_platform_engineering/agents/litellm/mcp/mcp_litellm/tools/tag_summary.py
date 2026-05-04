"""Tools for /tag/summary operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_get_tag_get(param_start_date: str, param_end_date: str, param_tag_filter: str | None = None, param_tag_filters: str | None = None) -> Any:
  """
      Get Tag Summary

      OpenAPI Description:
          Get summary analytics for tags including unique users, requests, tokens, and spend.

  Args:
      start_date: Start date for the analytics period (YYYY-MM-DD)
      end_date: End date for the analytics period (YYYY-MM-DD)
      tag_filter: Optional filter to specific tag (legacy)
      tag_filters: Optional filter to multiple specific tags (takes precedence over tag_filter)

  Returns:
      TagSummaryResponse: Summary analytics data by tag

      Args:

          param_start_date (str): Start date in YYYY-MM-DD format

          param_end_date (str): End date in YYYY-MM-DD format

          param_tag_filter (str): Filter by specific tag (optional)

          param_tag_filters (str): Filter by multiple specific tags (optional, takes precedence over tag_filter)


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /tag/summary")

  params = {}
  data = {}

  if param_start_date is not None:
    params["start_date"] = str(param_start_date).lower() if isinstance(param_start_date, bool) else param_start_date

  if param_end_date is not None:
    params["end_date"] = str(param_end_date).lower() if isinstance(param_end_date, bool) else param_end_date

  if param_tag_filter is not None:
    params["tag_filter"] = str(param_tag_filter).lower() if isinstance(param_tag_filter, bool) else param_tag_filter

  if param_tag_filters is not None:
    params["tag_filters"] = str(param_tag_filters).lower() if isinstance(param_tag_filters, bool) else param_tag_filters

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/tag/summary", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
