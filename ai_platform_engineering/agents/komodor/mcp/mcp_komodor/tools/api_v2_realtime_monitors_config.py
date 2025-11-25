"""Tools for /api/v2/realtime-monitors/config operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_api_config() -> Any:
  """


  OpenAPI Description:


  Args:


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/realtime-monitors/config")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/realtime-monitors/config", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def post_api_config(
  body_sensors: List[Dict[str, Any]],
  body_type: str,
  body_name: str = None,
  body_sinks: Dict[str, Any] = None,
  body_active: bool = None,
  body_variables: Dict[str, Any] = None,
  body_sinks_options_notify_on: List[str] = None,
) -> Any:
  """


  OpenAPI Description:


  Args:

      body_name (str): OpenAPI parameter corresponding to 'body_name'

      body_sensors (List[Dict[str, Any]]): OpenAPI parameter corresponding to 'body_sensors'

      body_sinks (Dict[str, Any]): OpenAPI parameter corresponding to 'body_sinks'

      body_active (bool): OpenAPI parameter corresponding to 'body_active'

      body_type (str): OpenAPI parameter corresponding to 'body_type'

      body_variables (Dict[str, Any]): OpenAPI parameter corresponding to 'body_variables'

      body_sinks_options_notify_on (List[str]): OpenAPI parameter corresponding to 'body_sinks_options_notify_on'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /api/v2/realtime-monitors/config")

  params = {}
  data = {}

  flat_body = {}
  if body_sensors is not None:
    flat_body["sensors"] = body_sensors
  if body_type is not None:
    flat_body["type"] = body_type
  if body_name is not None:
    flat_body["name"] = body_name
  if body_sinks is not None:
    flat_body["sinks"] = body_sinks
  if body_active is not None:
    flat_body["active"] = body_active
  if body_variables is not None:
    flat_body["variables"] = body_variables
  if body_sinks_options_notify_on is not None:
    flat_body["sinks_options_notify_on"] = body_sinks_options_notify_on
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/realtime-monitors/config", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
