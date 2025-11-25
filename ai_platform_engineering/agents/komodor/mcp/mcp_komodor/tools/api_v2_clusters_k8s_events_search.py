"""Tools for /api/v2/clusters/k8s-events/search operations"""

import logging
from typing import Any, List, Literal
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def post_post_api_search(
  body_scope_cluster: str,
  body_props_type: Literal["deploy", "node-terminated", "node-created"],
  body_scope_namespaces: List[str] = None,
  body_props_from_epoch: int = None,
  body_props_to_epoch: int = None,
  body_pagination_page_size: int = None,
  body_pagination_token: str = None,
) -> Any:
  """
  Search for k8s events in cluster scope

  OpenAPI Description:
      Search for events based on the provided criteria. Maximum time range is 2 days. If no time range is provided, the default is the last 24 hours. Maximum time back is 7 days.

  Args:

      body_scope_cluster (str): The cluster identifier

      body_scope_namespaces (List[str]): A list of namespaces within the cluster

      body_props_type (Literal['deploy', 'node-terminated', 'node-created']): The type of the event

      body_props_from_epoch (int): Unix timestamp in seconds

      body_props_to_epoch (int): Unix timestamp in seconds

      body_pagination_page_size (int): Page the number of results returned by page size

      body_pagination_token (str): Pagination token


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /api/v2/clusters/k8s-events/search")

  params = {}
  data = {}

  flat_body = {}
  if body_scope_cluster is not None:
    flat_body["scope_cluster"] = body_scope_cluster
  if body_props_type is not None:
    flat_body["props_type"] = body_props_type
  if body_scope_namespaces is not None:
    flat_body["scope_namespaces"] = body_scope_namespaces
  if body_props_from_epoch is not None:
    flat_body["props_from_epoch"] = body_props_from_epoch
  if body_props_to_epoch is not None:
    flat_body["props_to_epoch"] = body_props_to_epoch
  if body_pagination_page_size is not None:
    flat_body["pagination_page_size"] = body_pagination_page_size
  if body_pagination_token is not None:
    flat_body["pagination_token"] = body_pagination_token
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/clusters/k8s-events/search", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
