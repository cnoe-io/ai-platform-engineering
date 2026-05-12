"""Tools for /active/callbacks operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_active_callbacks_get() -> Any:
  """
      Active Callbacks

      OpenAPI Description:
          Returns a list of litellm level settings

  This is useful for debugging and ensuring the proxy server is configured correctly.

  Response schema:
  ```
  {
      "alerting": _alerting,
      "litellm.callbacks": litellm_callbacks,
      "litellm.input_callback": litellm_input_callbacks,
      "litellm.failure_callback": litellm_failure_callbacks,
      "litellm.success_callback": litellm_success_callbacks,
      "litellm._async_success_callback": litellm_async_success_callbacks,
      "litellm._async_failure_callback": litellm_async_failure_callbacks,
      "litellm._async_input_callback": litellm_async_input_callbacks,
      "all_litellm_callbacks": all_litellm_callbacks,
      "num_callbacks": len(all_litellm_callbacks),
      "num_alerting": _num_alerting,
      "litellm.request_timeout": litellm.request_timeout,
  }
  ```

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /active/callbacks")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/active/callbacks", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
