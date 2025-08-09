"""Tools for /api/v2/realtime-monitors/config/{id} operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_realtime_monitors_config_id(path_id: str) -> Dict[str, Any]:
    '''
    Fetches the configuration of a real-time monitor by its UUID.

    Args:
        path_id (str): The UUID of the monitor whose configuration is to be retrieved.

    Returns:
        Dict[str, Any]: The JSON response from the API call containing the monitor's configuration details.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /api/v2/realtime-monitors/config/{id}")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/api/v2/realtime-monitors/config/{path_id}", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def put_api_v2_realtime_monitors_config_id(
    path_id: str,
    body_sensors: List[str],
    body_type: str,
    body_name: str = None,
    body_sinks: Dict[str, Any] = None,
    body_active: bool = None,
    body_variables: Dict[str, Any] = None,
    body_sinksOptions_notifyOn: List[str] = None,
) -> Dict[str, Any]:
    '''
    Updates the configuration of a real-time monitor by its UUID.

    Args:
        path_id (str): UUID of the monitor to be updated.
        body_sensors (List[str]): List of sensors associated with the monitor.
        body_type (str): Type of the monitor.
        body_name (str, optional): Name of the monitor. Defaults to None.
        body_sinks (Dict[str, Any], optional): Configuration for data sinks. Defaults to None.
        body_active (bool, optional): Indicates if the monitor is active. Defaults to None.
        body_variables (Dict[str, Any], optional): Variables associated with the monitor. Defaults to None.
        body_sinksOptions_notifyOn (List[str], optional): Notification options for sinks. Defaults to None.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the updated monitor configuration.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making PUT request to /api/v2/realtime-monitors/config/{id}")

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
    if body_sinksOptions_notifyOn is not None:
        flat_body["sinksOptions_notifyOn"] = body_sinksOptions_notifyOn
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/api/v2/realtime-monitors/config/{path_id}", method="PUT", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response


async def delete_api_v2_realtime_monitors_config_id(path_id: str) -> Dict[str, Any]:
    '''
    Deletes a realtime monitor configuration by its UUID.

    Args:
        path_id (str): The UUID of the monitor to be deleted.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the result of the deletion operation.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making DELETE request to /api/v2/realtime-monitors/config/{id}")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/api/v2/realtime-monitors/config/{path_id}", method="DELETE", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response