"""Tools for /api/v2/cost/allocation operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_cost_allocation(
    param_timeFrame: str,
    param_groupBy: str,
    param_pageSize: int,
    param_clusterScope: List[str] = None,
    param_filterBy: str = None,
    param_filterValueEquals: str = None,
    param_sortOrder: str = None,
    param_sortBy: str = None,
) -> Dict[str, Any]:
    '''
    Get cost allocation breakdown.

    Retrieve a breakdown of cost allocation across clusters, workspaces, or any user-defined grouping.

    Args:
        param_timeFrame (str): The time frame for the cost allocation data.
        param_groupBy (str): The grouping criteria.
        param_pageSize (int): The number of items to return per page.
        param_clusterScope (List[str], optional): Filter by specific clusters. Defaults to None.
        param_filterBy (str, optional): Acceptable values depend on the selected `groupBy`:
            - groupBy = cluster → filterBy = clusterName
            - groupBy = namespace → filterBy = clusterName, namespace
            - groupBy = komodorServiceName → filterBy = clusterName, namespace, komodorServiceName, komodorServiceKind
            Defaults to None.
        param_filterValueEquals (str, optional): The value to filter by. Defaults to None.
        param_sortOrder (str, optional): The order of sorting for the cost allocation data. Defaults to None.
        param_sortBy (str, optional): The column by which to sort the cost allocation data. Defaults to None.

    Returns:
        Dict[str, Any]: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /api/v2/cost/allocation")

    params = {}
    data = {}

    if param_timeFrame is not None:
        params["timeFrame"] = str(param_timeFrame).lower() if isinstance(param_timeFrame, bool) else param_timeFrame

    if param_groupBy is not None:
        params["groupBy"] = str(param_groupBy).lower() if isinstance(param_groupBy, bool) else param_groupBy

    if param_clusterScope is not None:
        params["clusterScope"] = (
            str(param_clusterScope).lower() if isinstance(param_clusterScope, bool) else param_clusterScope
        )

    if param_filterBy is not None:
        params["filterBy"] = str(param_filterBy).lower() if isinstance(param_filterBy, bool) else param_filterBy

    if param_filterValueEquals is not None:
        params["filterValueEquals"] = (
            str(param_filterValueEquals).lower()
            if isinstance(param_filterValueEquals, bool)
            else param_filterValueEquals
        )

    if param_pageSize is not None:
        params["pageSize"] = str(param_pageSize).lower() if isinstance(param_pageSize, bool) else param_pageSize

    if param_sortOrder is not None:
        params["sortOrder"] = str(param_sortOrder).lower() if isinstance(param_sortOrder, bool) else param_sortOrder

    if param_sortBy is not None:
        params["sortBy"] = str(param_sortBy).lower() if isinstance(param_sortBy, bool) else param_sortBy

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request("/api/v2/cost/allocation", method="GET", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response