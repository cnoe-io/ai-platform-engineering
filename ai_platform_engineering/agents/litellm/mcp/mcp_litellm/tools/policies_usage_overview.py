"""Tools for /policies/usage/overview operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_policies_usage_get(param_start_date: str | None = None, param_end_date: str | None = None) -> Any:
  """
  Policies Usage Overview

  OpenAPI Description:
      Return policy performance overview for the dashboard.

  Args:

      param_start_date (str): YYYY-MM-DD

      param_end_date (str): YYYY-MM-DD


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /policies/usage/overview")

  params = {}
  data = {}

  if param_start_date is not None:
    params["start_date"] = str(param_start_date).lower() if isinstance(param_start_date, bool) else param_start_date

  if param_end_date is not None:
    params["end_date"] = str(param_end_date).lower() if isinstance(param_end_date, bool) else param_end_date

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/policies/usage/overview", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
