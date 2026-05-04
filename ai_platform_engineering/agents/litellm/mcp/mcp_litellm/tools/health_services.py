"""Tools for /health/services operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_health_svcs_get(param_service: str) -> Any:
  """
      Health Services Endpoint

      OpenAPI Description:
          Use this admin-only endpoint to check if the service is healthy.

  Example:
  ```
  curl -L -X GET 'http://0.0.0.0:4000/health/services?service=datadog'     -H 'Authorization: Bearer sk-1234'
  ```

      Args:

          param_service (str): Specify the service being hit.


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /health/services")

  params = {}
  data = {}

  if param_service is not None:
    params["service"] = str(param_service).lower() if isinstance(param_service, bool) else param_service

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/health/services", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
