"""Tools for /api/v2/cost/allocation operations"""

import logging
from typing import Any, List, Literal
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_cost_allocation(
  param_time_frame: Literal["Yesterday", "Past_7_days", "Past_14_days", "Past_30_days"],
  param_group_by: Literal["clusterName", "namespace", "komodorServiceName"],
  param_page_size: int,
  param_cluster_scope: List[str] = None,
  param_filter_by: Literal["clusterName", "namespace", "komodorServiceName", "komodorServiceKind"] = None,
  param_filter_value_equals: str = None,
  param_pagination_token: str = None,
  param_sort_order: Literal["asc", "desc"] = None,
  param_sort_by: Literal[
    "clusterName",
    "namespace",
    "komodorServiceName",
    "komodorServiceKind",
    "cpuRequestCoreHours",
    "memoryRequestGBHours",
    "totalCost",
    "optimizationScore",
    "efficiency",
    "potentialSaving",
  ] = None,
) -> Any:
  """
    Get cost allocation breakdown.

    OpenAPI Description:
        Retrieve a breakdown of cost allocation across clusters, workspaces, or any user-defined grouping.

    Args:

        param_time_frame (Literal['Yesterday', 'Past_7_days', 'Past_14_days', 'Past_30_days']): The time frame for the cost allocation data.

        param_group_by (Literal['clusterName', 'namespace', 'komodorServiceName']): The grouping criteria

        param_cluster_scope (List[str]): Filter by specific clusters.

        param_filter_by (Literal['clusterName', 'namespace', 'komodorServiceName', 'komodorServiceKind']): Acceptable values depend on the selected `groupBy`:
  - groupBy = clusterName → filterBy = clusterName
  - groupBy = namespace → filterBy = clusterName, namespace
  - groupBy = komodorServiceName → filterBy = clusterName, namespace, komodorServiceName, komodorServiceKind


        param_filter_value_equals (str): The value to filter by.

        param_page_size (int): The number of items to return per page.

        param_pagination_token (str): The pagination token for the next page of results.

        param_sort_order (Literal['asc', 'desc']): The order of sorting for the cost allocation data.

        param_sort_by (Literal['clusterName', 'namespace', 'komodorServiceName', 'komodorServiceKind', 'cpuRequestCoreHours', 'memoryRequestGBHours', 'totalCost', 'optimizationScore', 'efficiency', 'potentialSaving']): The column by which to sort the cost allocation data.


    Returns:
        Any: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/cost/allocation")

  params = {}
  data = {}

  if param_time_frame is not None:
    params["time_frame"] = str(param_time_frame).lower() if isinstance(param_time_frame, bool) else param_time_frame

  if param_group_by is not None:
    params["group_by"] = str(param_group_by).lower() if isinstance(param_group_by, bool) else param_group_by

  if param_cluster_scope is not None:
    params["cluster_scope"] = str(param_cluster_scope).lower() if isinstance(param_cluster_scope, bool) else param_cluster_scope

  if param_filter_by is not None:
    params["filter_by"] = str(param_filter_by).lower() if isinstance(param_filter_by, bool) else param_filter_by

  if param_filter_value_equals is not None:
    params["filter_value_equals"] = (
      str(param_filter_value_equals).lower() if isinstance(param_filter_value_equals, bool) else param_filter_value_equals
    )

  if param_page_size is not None:
    params["page_size"] = str(param_page_size).lower() if isinstance(param_page_size, bool) else param_page_size

  if param_pagination_token is not None:
    params["pagination_token"] = str(param_pagination_token).lower() if isinstance(param_pagination_token, bool) else param_pagination_token

  if param_sort_order is not None:
    params["sort_order"] = str(param_sort_order).lower() if isinstance(param_sort_order, bool) else param_sort_order

  if param_sort_by is not None:
    params["sort_by"] = str(param_sort_by).lower() if isinstance(param_sort_by, bool) else param_sort_by

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/cost/allocation", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
