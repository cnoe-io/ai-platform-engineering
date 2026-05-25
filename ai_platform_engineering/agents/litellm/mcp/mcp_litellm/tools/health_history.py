"""Tools for /health/history operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_health_check_get(
  param_model: str | None = None, param_status_filter: str | None = None, param_limit: int | None = None, param_offset: int | None = None
) -> Any:
  """
      Health Check History Endpoint

      OpenAPI Description:
          Get health check history for models

  Returns historical health check data with optional filtering.

      Args:

          param_model (str): Filter by specific model name

          param_status_filter (str): Filter by status (healthy/unhealthy)

          param_limit (int): Number of records to return

          param_offset (int): Number of records to skip


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /health/history")

  params = {}
  data = {}

  if param_model is not None:
    params["model"] = str(param_model).lower() if isinstance(param_model, bool) else param_model

  if param_status_filter is not None:
    params["status_filter"] = str(param_status_filter).lower() if isinstance(param_status_filter, bool) else param_status_filter

  if param_limit is not None:
    params["limit"] = str(param_limit).lower() if isinstance(param_limit, bool) else param_limit

  if param_offset is not None:
    params["offset"] = str(param_offset).lower() if isinstance(param_offset, bool) else param_offset

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/health/history", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
