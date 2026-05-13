"""Tools for /health/backlog operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_health_backlog_get() -> Any:
  """
      Health Backlog

      OpenAPI Description:
          Returns the number of HTTP requests currently in-flight on this uvicorn worker.

  Use this to measure per-pod queue depth. A high value means the worker is
  processing many concurrent requests — requests arriving now will have to wait
  for the event loop to get to them, adding latency before LiteLLM even starts
  its own timer.

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /health/backlog")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/health/backlog", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
