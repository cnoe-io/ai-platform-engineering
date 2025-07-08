"""Tools for /mgmt/v1/monitors/config operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def monitors_controller_v1_get_all() -> Dict[str, Any]:
    '''
    Fetches all monitor configurations.

    This function is deprecated. Please use `/api/v2/realtime-monitors/config` API instead for new implementations and better validation and error handling.

    Returns:
        Dict[str, Any]: The JSON response from the API call containing monitor configurations.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /mgmt/v1/monitors/config")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/mgmt/v1/monitors/config", method="GET", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def monitors_controller_v1_post(
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

    This function makes a POST request to the `/mgmt/v1/monitors/config` endpoint to configure monitor settings. It is deprecated and should be replaced with `/api/v2/realtime-monitors/config` for new implementations.

    Args:
        body_name (str): The name of the monitor.
        body_type (str): The type of the monitor.
        body_active (bool): Indicates if the monitor is active.
        body_sensors (List[str]): List of sensors associated with the monitor.
        body_isDeleted (bool): Indicates if the monitor is marked as deleted.
        body_variables_duration (float, optional): Duration for which the monitor variables are valid. Defaults to None.
        body_variables_minAvailable (str, optional): Minimum availability required for the monitor. Defaults to None.
        body_variables_categories (List[str], optional): Categories to filter for "Availability" monitor type. Defaults to None.
        body_variables_cronJobCondition (str, optional): Condition for cron jobs related to the monitor. Defaults to None.
        body_variables_resolveAfter (float, optional): Time after which issues are resolved automatically. Defaults to None.
        body_variables_ignoreAfter (float, optional): Time after which issues are ignored. Defaults to None.
        body_variables_reasons (List[str], optional): Reasons associated with the monitor variables. Defaults to None.
        body_variables_nodeCreationThreshold (str, optional): Threshold for node creation related to the monitor. Defaults to None.
        body_sinks (str, optional): Sinks associated with the monitor. Defaults to None.
        body_sinksOptions_notifyOn (List[str], optional): Categories for notifications. Defaults to None.

    Returns:
        Dict[str, Any]: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making POST request to /mgmt/v1/monitors/config")

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

    success, response = await make_api_request("/mgmt/v1/monitors/config", method="POST", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response