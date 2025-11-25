"""Tools for /api/v2/cost/right-sizing/service operations"""

import logging
from typing import Any, List, Literal
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_cost_right_sizing_per_svc(
  param_optimization_strategy: Literal["conservative", "moderate", "aggressive"],
  param_page_size: int,
  param_pagination_token: str = None,
  param_filter_by: Literal["clusterName", "namespace", "komodorServiceName", "komodorServiceKind"] = None,
  param_filter_value_equals: str = None,
  param_sort_order: Literal["asc", "desc"] = None,
  param_sort_by: Literal["clusterName", "namespace", "service", "komodorServiceKind", "optimizationScore", "potentialSaving"] = None,
  param_cluster_scope: List[str] = None,
) -> Any:
  """
  Get cost right-sizing recommendations per service.

  OpenAPI Description:
      Get recommended CPU and memory request adjustments per service to optimize cost.

  Args:

      param_optimization_strategy (Literal['conservative', 'moderate', 'aggressive']): The optimization strategy to use.

      param_page_size (int): The number of items to return per page.

      param_pagination_token (str): The pagination token for the next page of results.

      param_filter_by (Literal['clusterName', 'namespace', 'komodorServiceName', 'komodorServiceKind']): filterByRightSizingColumn

      param_filter_value_equals (str): The value to filter by.

      param_sort_order (Literal['asc', 'desc']): The order of sorting for the cost allocation data.

      param_sort_by (Literal['clusterName', 'namespace', 'service', 'komodorServiceKind', 'optimizationScore', 'potentialSaving']): The column by which to sort the right-sizing data.

      param_cluster_scope (List[str]): Filter by specific clusters.


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/cost/right-sizing/service")

  params = {}
  data = {}

  if param_optimization_strategy is not None:
    params["optimization_strategy"] = (
      str(param_optimization_strategy).lower() if isinstance(param_optimization_strategy, bool) else param_optimization_strategy
    )

  if param_page_size is not None:
    params["page_size"] = str(param_page_size).lower() if isinstance(param_page_size, bool) else param_page_size

  if param_pagination_token is not None:
    params["pagination_token"] = str(param_pagination_token).lower() if isinstance(param_pagination_token, bool) else param_pagination_token

  if param_filter_by is not None:
    params["filter_by"] = str(param_filter_by).lower() if isinstance(param_filter_by, bool) else param_filter_by

  if param_filter_value_equals is not None:
    params["filter_value_equals"] = (
      str(param_filter_value_equals).lower() if isinstance(param_filter_value_equals, bool) else param_filter_value_equals
    )

  if param_sort_order is not None:
    params["sort_order"] = str(param_sort_order).lower() if isinstance(param_sort_order, bool) else param_sort_order

  if param_sort_by is not None:
    params["sort_by"] = str(param_sort_by).lower() if isinstance(param_sort_by, bool) else param_sort_by

  if param_cluster_scope is not None:
    params["cluster_scope"] = str(param_cluster_scope).lower() if isinstance(param_cluster_scope, bool) else param_cluster_scope

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/cost/right-sizing/service", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
