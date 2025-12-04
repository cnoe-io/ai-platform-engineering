"""Tools for /mgmt/v1/monitors/config/{id} operations"""

import logging
from typing import Dict, Any, List, Literal, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_monitors_controller_v1_get(path_id: str) -> Any:
  """
  Deprecated: Use `/api/v2/realtime-monitors/config` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/realtime-monitors/config` API instead for new implementations and better validation and error handling.

  Args:

      path_id (str): uuid of a monitor


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /mgmt/v1/monitors/config/{id}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/mgmt/v1/monitors/config/{path_id}", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def put_monitors_controller_v1_put(
  path_id: str,
  body_name: str,
  body_type: Literal["availability", "node", "PVC", "service", "job", "cronJob", "deploy", "workflow"],
  body_active: bool,
  body_sensors: List[Dict[str, Any]],
  body_is_deleted: bool,
  body_variables_duration: Optional[float] = None,
  body_variables_min_available: Optional[str] = None,
  body_variables_categories: Optional[List[str]] = None,
  body_variables_cron_job_condition: Optional[str] = None,
  body_variables_resolve_after: Optional[float] = None,
  body_variables_ignore_after: Optional[float] = None,
  body_variables_reasons: Optional[List[str]] = None,
  body_variables_node_creation_threshold: Optional[str] = None,
  body_sinks: Optional[str] = None,
  body_sinks_options_notify_on: Optional[List[str]] = None,
) -> Any:
  """
     Deprecated: Use `/api/v2/realtime-monitors/config` instead.

     OpenAPI Description:
         This API is deprecated. Please use `/api/v2/realtime-monitors/config` API instead for new implementations and better validation and error handling.

     Args:

         path_id (str): uuid of a monitor

         body_name (str): OpenAPI parameter corresponding to 'body_name'

         body_type (Literal['availability', 'node', 'PVC', 'service', 'job', 'cronJob', 'deploy', 'workflow']): OpenAPI parameter corresponding to 'body_type'

         body_active (bool): OpenAPI parameter corresponding to 'body_active'

         body_sensors (List[Dict[str, Any]]): OpenAPI parameter corresponding to 'body_sensors'

         body_variables_duration (float): OpenAPI parameter corresponding to 'body_variables_duration'

         body_variables_min_available (str): OpenAPI parameter corresponding to 'body_variables_min_available'

         body_variables_categories (List[str]): Filtering categories to monitor for "Availability" monitor type ("*" means all).


  https://docs.komodor.com/Learn/Monitors.html#availability-monitor

         body_variables_cron_job_condition (str): OpenAPI parameter corresponding to 'body_variables_cron_job_condition'

         body_variables_resolve_after (float): OpenAPI parameter corresponding to 'body_variables_resolve_after'

         body_variables_ignore_after (float): OpenAPI parameter corresponding to 'body_variables_ignore_after'

         body_variables_reasons (List[str]): OpenAPI parameter corresponding to 'body_variables_reasons'

         body_variables_node_creation_threshold (str): OpenAPI parameter corresponding to 'body_variables_node_creation_threshold'

         body_sinks (str): OpenAPI parameter corresponding to 'body_sinks'

         body_sinks_options_notify_on (List[str]): Categories for notifications.

  "Deploy" monitor options: [Failure, Successful, All].

  "Availability" monitor ("*" means all) - https://docs.komodor.com/Learn/Monitors.html#availability-monitor

         body_is_deleted (bool): OpenAPI parameter corresponding to 'body_is_deleted'


     Returns:
         Any: The JSON response from the API call.

     Raises:
         Exception: If the API request fails or returns an error.
  """
  logger.debug("Making PUT request to /mgmt/v1/monitors/config/{id}")

  params = {}
  data = {}

  flat_body = {}
  if body_name is not None:
    flat_body["name"] = body_name
  if body_type is not None:
    flat_body["type"] = body_type
  if body_active is not None:
    flat_body["active"] = body_active
  if body_sensors is not None:
    flat_body["sensors"] = body_sensors
  if body_is_deleted is not None:
    flat_body["is_deleted"] = body_is_deleted
  if body_variables_duration is not None:
    flat_body["variables_duration"] = body_variables_duration
  if body_variables_min_available is not None:
    flat_body["variables_min_available"] = body_variables_min_available
  if body_variables_categories is not None:
    flat_body["variables_categories"] = body_variables_categories
  if body_variables_cron_job_condition is not None:
    flat_body["variables_cron_job_condition"] = body_variables_cron_job_condition
  if body_variables_resolve_after is not None:
    flat_body["variables_resolve_after"] = body_variables_resolve_after
  if body_variables_ignore_after is not None:
    flat_body["variables_ignore_after"] = body_variables_ignore_after
  if body_variables_reasons is not None:
    flat_body["variables_reasons"] = body_variables_reasons
  if body_variables_node_creation_threshold is not None:
    flat_body["variables_node_creation_threshold"] = body_variables_node_creation_threshold
  if body_sinks is not None:
    flat_body["sinks"] = body_sinks
  if body_sinks_options_notify_on is not None:
    flat_body["sinks_options_notify_on"] = body_sinks_options_notify_on
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/mgmt/v1/monitors/config/{path_id}", method="PUT", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response


async def del_monitors_controller_v1_del(path_id: str) -> Any:
  """
  Deprecated: Use `/api/v2/realtime-monitors/config` instead.

  OpenAPI Description:
      This API is deprecated. Please use `/api/v2/realtime-monitors/config` API instead for new implementations and better validation and error handling.

  Args:

      path_id (str): uuid of a monitor


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making DELETE request to /mgmt/v1/monitors/config/{id}")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request(f"/mgmt/v1/monitors/config/{path_id}", method="DELETE", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
