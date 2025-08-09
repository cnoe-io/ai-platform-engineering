"""Tools for /api/v2/health/risks operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_health_risks(
    param_pageSize: int,
    param_offset: int,
    param_impactGroupType: List[str] = ["static"],
    param_checkType: List[str] = None,
    param_status: List[str] = None,
    param_clusterName: List[str] = None,
    param_namespace: List[str] = None,
    param_shortResourceNameSearchTerm: str = None,
    param_shortResourceName: List[str] = None,
    param_impactGroupId: List[str] = None,
    param_severity: List[str] = None,
    param_komodorUid: List[str] = None,
    param_resourceType: List[str] = None,
    param_createdFromEpoch: str = None,
    param_createdToEpoch: str = None,
    param_checkCategory: List[str] = None,
) -> Dict[str, Any]:
    '''
    Get all the health risks.

    Args:
        param_pageSize (int): The number of items to return per page.
        param_offset (int): The offset from the start of the list of items.
        param_impactGroupType (List[str]): The type of impact group to filter by. Defaults to ["static"].
        param_checkType (List[str], optional): The type of checks to filter by. Defaults to None.
        param_status (List[str], optional): The status of the health risks to filter by. Defaults to None.
        param_clusterName (List[str], optional): The name of the cluster to filter by. Defaults to None.
        param_namespace (List[str], optional): The namespace to filter by. Defaults to None.
        param_shortResourceNameSearchTerm (str, optional): A search term for resource names using a "contains" approach. Defaults to None.
        param_shortResourceName (List[str], optional): Specific resource names to filter by. Defaults to None.
        param_impactGroupId (List[str], optional): The ID of the impact group to filter by. Defaults to None.
        param_severity (List[str], optional): The severity level of the health risks to filter by. Defaults to None.
        param_komodorUid (List[str], optional): The Komodor UID to filter by. Defaults to None.
        param_resourceType (List[str], optional): The type of resource to filter by. Defaults to None.
        param_createdFromEpoch (str, optional): The start epoch time to filter the creation date. Defaults to None.
        param_createdToEpoch (str, optional): The end epoch time to filter the creation date. Defaults to None.
        param_checkCategory (List[str], optional): The category of checks to filter by. Defaults to None.

    Returns:
        Dict[str, Any]: The JSON response from the API call containing health risks data.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /api/v2/health/risks")

    params = {}
    data = {}

    if param_pageSize is not None:
        params["pageSize"] = str(param_pageSize).lower() if isinstance(param_pageSize, bool) else param_pageSize

    if param_offset is not None:
        params["offset"] = str(param_offset).lower() if isinstance(param_offset, bool) else param_offset

    if param_checkType is not None:
        params["checkType"] = str(param_checkType).lower() if isinstance(param_checkType, bool) else param_checkType

    if param_status is not None:
        params["status"] = str(param_status).lower() if isinstance(param_status, bool) else param_status

    if param_clusterName is not None:
        params["clusterName"] = (
            str(param_clusterName).lower() if isinstance(param_clusterName, bool) else param_clusterName
        )

    if param_namespace is not None:
        params["namespace"] = str(param_namespace).lower() if isinstance(param_namespace, bool) else param_namespace

    if param_shortResourceNameSearchTerm is not None:
        params["shortResourceNameSearchTerm"] = (
            str(param_shortResourceNameSearchTerm).lower()
            if isinstance(param_shortResourceNameSearchTerm, bool)
            else param_shortResourceNameSearchTerm
        )

    if param_shortResourceName is not None:
        params["shortResourceName"] = (
            str(param_shortResourceName).lower()
            if isinstance(param_shortResourceName, bool)
            else param_shortResourceName
        )

    if param_impactGroupId is not None:
        params["impactGroupId"] = (
            str(param_impactGroupId).lower() if isinstance(param_impactGroupId, bool) else param_impactGroupId
        )

    if param_impactGroupType is not None:
        params["impactGroupType"] = (
            str(param_impactGroupType).lower() if isinstance(param_impactGroupType, bool) else param_impactGroupType
        )

    if param_severity is not None:
        params["severity"] = str(param_severity).lower() if isinstance(param_severity, bool) else param_severity

    if param_komodorUid is not None:
        params["komodorUid"] = str(param_komodorUid).lower() if isinstance(param_komodorUid, bool) else param_komodorUid

    if param_resourceType is not None:
        params["resourceType"] = (
            str(param_resourceType).lower() if isinstance(param_resourceType, bool) else param_resourceType
        )

    if param_createdFromEpoch is not None:
        params["createdFromEpoch"] = (
            str(param_createdFromEpoch).lower() if isinstance(param_createdFromEpoch, bool) else param_createdFromEpoch
        )

    if param_createdToEpoch is not None:
        params["createdToEpoch"] = (
            str(param_createdToEpoch).lower() if isinstance(param_createdToEpoch, bool) else param_createdToEpoch
        )

    if param_checkCategory is not None:
        params["checkCategory"] = (
            str(param_checkCategory).lower() if isinstance(param_checkCategory, bool) else param_checkCategory
        )

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/api/v2/health/risks", method="GET", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response
