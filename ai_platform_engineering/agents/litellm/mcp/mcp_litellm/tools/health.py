"""Tools for /health operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_health_endpoint_health_get(param_model: str | None = None, param_model_id: str | None = None) -> Any:
  """
      Health Endpoint

      OpenAPI Description:
          🚨 USE `/health/liveliness` to health check the proxy 🚨

  See more 👉 https://docs.litellm.ai/docs/proxy/health


  Check the health of all the endpoints in config.yaml

  To run health checks in the background, add this to config.yaml:
  ```
  general_settings:
      # ... other settings
      background_health_checks: True
  ```
  else, the health checks will be run on models when /health is called.

      Args:

          param_model (str): Specify the model name (optional)

          param_model_id (str): Specify the model ID (optional)


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /health")

  params = {}
  data = {}

  if param_model is not None:
    params["model"] = str(param_model).lower() if isinstance(param_model, bool) else param_model

  if param_model_id is not None:
    params["model_id"] = str(param_model_id).lower() if isinstance(param_model_id, bool) else param_model_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/health", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
