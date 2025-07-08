"""Tools for /mgmt/v1/monitors/config/{id} operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def monitors_controller_v1_get(path_id: str) -> Dict[str, Any]:
    '''
    Fetches the configuration of a monitor by its UUID.

    This function is deprecated. Please use `/api/v2/realtime-monitors/config` API instead for new implementations and better validation and error handling.

    Args:
        path_id (str): UUID of the monitor to retrieve the configuration for.

    Returns:
        Dict[str, Any]: The JSON response from the API call containing the monitor configuration.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /mgmt/v1/monitors/config/{id}")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/mgmt/v1/monitors/config/{path_id}", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def monitors_controller_v1_put(
    path_id: str,
    body_name: str,
    body_type: str,
    body_active: bool,
    body_sensors: List[str],
    body_isDeleted: bool,
    body_variables_duration: float = None,
    body_variables_minAvailable: str = None,
    body_variables_categories: List[str] = None,
    body_variables_cronJobCondition: str = None,
    body_variables_resolveAfter: float = None,
    body_variables_ignoreAfter: float = None,
    body_variables_reasons: List[str] = None,
    body_variables_nodeCreationThreshold: str = None,
    body_sinks: str = None,
    body_sinksOptions_notifyOn: List[str] = None,
) -> Dict[str, Any]:
    '''
    Deprecated: Use `/api/v2/realtime-monitors/config` instead.

    This function makes a PUT request to update the configuration of a monitor.
    It is recommended to use the newer `/api/v2/realtime-monitors/config` API for
    better validation and error handling.

    Args:
        path_id (str): UUID of the monitor to be updated.
        body_name (str): Name of the monitor.
        body_type (str): Type of the monitor.
        body_active (bool): Indicates if the monitor is active.
        body_sensors (List[str]): List of sensors associated with the monitor.
        body_isDeleted (bool): Indicates if the monitor is marked as deleted.
        body_variables_duration (float, optional): Duration variable for the monitor. Defaults to None.
        body_variables_minAvailable (str, optional): Minimum available variable for the monitor. Defaults to None.
        body_variables_categories (List[str], optional): Categories to monitor for "Availability" monitor type. Defaults to None.
        body_variables_cronJobCondition (str, optional): Cron job condition variable for the monitor. Defaults to None.
        body_variables_resolveAfter (float, optional): Time after which the monitor resolves. Defaults to None.
        body_variables_ignoreAfter (float, optional): Time after which the monitor ignores. Defaults to None.
        body_variables_reasons (List[str], optional): Reasons associated with the monitor. Defaults to None.
        body_variables_nodeCreationThreshold (str, optional): Node creation threshold variable for the monitor. Defaults to None.
        body_sinks (str, optional): Sinks associated with the monitor. Defaults to None.
        body_sinksOptions_notifyOn (List[str], optional): Categories for notifications. Defaults to None.

    Returns:
        Dict[str, Any]: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
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
    if body_isDeleted is not None:
        flat_body["isDeleted"] = body_isDeleted
    if body_variables_duration is not None:
        flat_body["variables_duration"] = body_variables_duration
    if body_variables_minAvailable is not None:
        flat_body["variables_minAvailable"] = body_variables_minAvailable
    if body_variables_categories is not None:
        flat_body["variables_categories"] = body_variables_categories
    if body_variables_cronJobCondition is not None:
        flat_body["variables_cronJobCondition"] = body_variables_cronJobCondition
    if body_variables_resolveAfter is not None:
        flat_body["variables_resolveAfter"] = body_variables_resolveAfter
    if body_variables_ignoreAfter is not None:
        flat_body["variables_ignoreAfter"] = body_variables_ignoreAfter
    if body_variables_reasons is not None:
        flat_body["variables_reasons"] = body_variables_reasons
    if body_variables_nodeCreationThreshold is not None:
        flat_body["variables_nodeCreationThreshold"] = body_variables_nodeCreationThreshold
    if body_sinks is not None:
        flat_body["sinks"] = body_sinks
    if body_sinksOptions_notifyOn is not None:
        flat_body["sinksOptions_notifyOn"] = body_sinksOptions_notifyOn
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/mgmt/v1/monitors/config/{path_id}", method="PUT", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def monitors_controller_v1_delete(path_id: str) -> Dict[str, Any]:
    '''
    Deletes a monitor configuration using its UUID.

    This function is deprecated. Please use the `/api/v2/realtime-monitors/config` API for new implementations, which offers better validation and error handling.

    Args:
        path_id (str): The UUID of the monitor to be deleted.

    Returns:
        Dict[str, Any]: The JSON response from the API call, which includes the result of the delete operation.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making DELETE request to /mgmt/v1/monitors/config/{id}")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/mgmt/v1/monitors/config/{path_id}", method="DELETE", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response