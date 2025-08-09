"""Tools for /api/v2/audit-log operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_audit_log(
    param_id: str = None,
    param_userIds: List[str] = None,
    param_actions: List[str] = None,
    param_categories: List[str] = None,
    param_operations: List[str] = None,
    param_entityTypes: List[str] = None,
    param_entityName: str = None,
    param_startTime: str = None,
    param_endTime: str = None,
    param_status: str = None,
    param_page: int = None,
    param_pageSize: int = None,
    param_sort: str = None,
) -> Dict[str, Any]:
    '''
    Query audit logs with filters, sort, and pagination.

    Args:
        param_id (str, optional): Audit log id. Defaults to all ids if not provided.
        param_userIds (List[str], optional): List of user IDs to filter the audit logs. Defaults to None.
        param_actions (List[str], optional): List of actions to filter the audit logs. Defaults to None.
        param_categories (List[str], optional): List of categories to filter the audit logs. Defaults to None.
        param_operations (List[str], optional): List of operations to filter the audit logs. Defaults to None.
        param_entityTypes (List[str], optional): List of entity types to filter the audit logs. Defaults to None.
        param_entityName (str, optional): Name of the entity to filter the audit logs. Defaults to None.
        param_startTime (str, optional): Start time for the audit logs query. Defaults to 8 hours ago if not provided. Ignored if the response is CSV.
        param_endTime (str, optional): End time for the audit logs query. Defaults to now if not provided. Ignored if the response is CSV.
        param_status (str, optional): Status to filter the audit logs. Defaults to all statuses if not provided.
        param_page (int, optional): Page number for pagination. Defaults to 1 if not provided. Ignored if the response is CSV.
        param_pageSize (int, optional): Page size for pagination. Defaults to 20 if not provided. Ignored if the response is CSV.
        param_sort (str, optional): Sort order for the audit logs. Defaults to None.

    Returns:
        Dict[str, Any]: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /api/v2/audit-log")

    params = {}
    data = {}

    if param_id is not None:
        params["id"] = str(param_id).lower() if isinstance(param_id, bool) else param_id

    if param_userIds is not None:
        params["userIds"] = str(param_userIds).lower() if isinstance(param_userIds, bool) else param_userIds

    if param_actions is not None:
        params["actions"] = str(param_actions).lower() if isinstance(param_actions, bool) else param_actions

    if param_categories is not None:
        params["categories"] = str(param_categories).lower() if isinstance(param_categories, bool) else param_categories

    if param_operations is not None:
        params["operations"] = str(param_operations).lower() if isinstance(param_operations, bool) else param_operations

    if param_entityTypes is not None:
        params["entityTypes"] = (
            str(param_entityTypes).lower() if isinstance(param_entityTypes, bool) else param_entityTypes
        )

    if param_entityName is not None:
        params["entityName"] = str(param_entityName).lower() if isinstance(param_entityName, bool) else param_entityName

    if param_startTime is not None:
        params["startTime"] = str(param_startTime).lower() if isinstance(param_startTime, bool) else param_startTime

    if param_endTime is not None:
        params["endTime"] = str(param_endTime).lower() if isinstance(param_endTime, bool) else param_endTime

    if param_status is not None:
        params["status"] = str(param_status).lower() if isinstance(param_status, bool) else param_status

    if param_page is not None:
        params["page"] = str(param_page).lower() if isinstance(param_page, bool) else param_page

    if param_pageSize is not None:
        params["pageSize"] = str(param_pageSize).lower() if isinstance(param_pageSize, bool) else param_pageSize

    if param_sort is not None:
        params["sort"] = str(param_sort).lower() if isinstance(param_sort, bool) else param_sort

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/api/v2/audit-log", method="GET", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response