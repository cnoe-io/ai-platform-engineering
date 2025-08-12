"""Tools for /api/v2/cost/right-sizing/service operations"""

import logging
from typing import Dict, Any, List
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_cost_right_sizing_per_service(
    param_optimizationStrategy: str,
    param_pageSize: int,
    param_filterBy: str = None,
    param_filterValueEquals: str = None,
    param_sortOrder: str = None,
    param_sortBy: str = None,
    param_clusterScope: List[str] = None,
) -> Dict[str, Any]:
    '''
    Get cost right-sizing recommendations per service.

    Args:
        param_optimizationStrategy (str): The optimization strategy to use.
        param_pageSize (int): The number of items to return per page.
        param_filterBy (str, optional): The column to filter by for right-sizing. Defaults to None.
        param_filterValueEquals (str, optional): The value to filter by. Defaults to None.
        param_sortOrder (str, optional): The order of sorting for the cost allocation data. Defaults to None.
        param_sortBy (str, optional): The column by which to sort the right-sizing data. Defaults to None.
        param_clusterScope (List[str], optional): Filter by specific clusters. Defaults to None.

    Returns:
        Dict[str, Any]: The JSON response from the API call containing recommended CPU and memory request adjustments per service.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making GET request to /api/v2/cost/right-sizing/service")

    params = {}
    data = {}

    if param_optimizationStrategy is not None:
        params["optimizationStrategy"] = (
            str(param_optimizationStrategy).lower()
            if isinstance(param_optimizationStrategy, bool)
            else param_optimizationStrategy
        )

    if param_pageSize is not None:
        params["pageSize"] = str(param_pageSize).lower() if isinstance(param_pageSize, bool) else param_pageSize

    if param_filterBy is not None:
        params["filterBy"] = str(param_filterBy).lower() if isinstance(param_filterBy, bool) else param_filterBy

    if param_filterValueEquals is not None:
        params["filterValueEquals"] = (
            str(param_filterValueEquals).lower()
            if isinstance(param_filterValueEquals, bool)
            else param_filterValueEquals
        )

    if param_sortOrder is not None:
        params["sortOrder"] = str(param_sortOrder).lower() if isinstance(param_sortOrder, bool) else param_sortOrder

    if param_sortBy is not None:
        params["sortBy"] = str(param_sortBy).lower() if isinstance(param_sortBy, bool) else param_sortBy

    if param_clusterScope is not None:
        params["clusterScope"] = (
            str(param_clusterScope).lower() if isinstance(param_clusterScope, bool) else param_clusterScope
        )

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        "/api/v2/cost/right-sizing/service", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response