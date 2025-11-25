"""Tools for /api/v2/services/search operations"""

import logging
from typing import Any, List, Literal
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def post_api_v2_svcs_search(
  body_scope_cluster: str = None,
  body_scope_namespaces: List[str] = None,
  body_kind: List[Literal["Deployment", "DaemonSet", "StatefulSet", "Rollout"]] = None,
  body_status: Literal["healthy", "unhealthy", "unknown"] = None,
  body_issue_reason_category: List[
    Literal[
      "NonZeroExitCode",
      "Unhealthy",
      "OOMKilled",
      "Creating/Initializing",
      "BackOff",
      "Infrastructure",
      "Pending",
      "Image",
      "Volume/Secret/ConfigMap",
      "Container Creation",
      "Pod Termination",
      "Completed",
      "Other",
    ]
  ] = None,
  body_latest_deploy_status: Literal["success", "failure", "pending", "unknown"] = None,
  body_pagination_page_size: int = None,
  body_pagination_page: int = None,
) -> Any:
  """
  Search for services

  OpenAPI Description:
      Search for services based on the provided criteria. If no criteria is provided, the default is to return all services.

  Args:

      body_scope_cluster (str): The cluster identifier

      body_scope_namespaces (List[str]): A list of namespaces within the cluster

      body_kind (List[Literal['Deployment', 'DaemonSet', 'StatefulSet', 'Rollout']]): The type of the service

      body_status (Literal['healthy', 'unhealthy', 'unknown']): The health status of the service

      body_issue_reason_category (List[Literal['NonZeroExitCode', 'Unhealthy', 'OOMKilled',
          'Creating/Initializing', 'BackOff', 'Infrastructure', 'Pending', 'Image',
          'Volume/Secret/ConfigMap', 'Container Creation', 'Pod Termination', 'Completed', 'Other']]):
          OpenAPI parameter corresponding to 'body_issue_reason_category'

      body_latest_deploy_status (Literal['success', 'failure', 'pending', 'unknown']): The status of the latest deployment

      body_pagination_page_size (int): Page the number of results returned by page size

      body_pagination_page (int): The page number


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /api/v2/services/search")

  params = {}
  data = {}

  flat_body = {}
  if body_scope_cluster is not None:
    flat_body["scope_cluster"] = body_scope_cluster
  if body_scope_namespaces is not None:
    flat_body["scope_namespaces"] = body_scope_namespaces
  if body_kind is not None:
    flat_body["kind"] = body_kind
  if body_status is not None:
    flat_body["status"] = body_status
  if body_issue_reason_category is not None:
    flat_body["issue_reason_category"] = body_issue_reason_category
  if body_latest_deploy_status is not None:
    flat_body["latest_deploy_status"] = body_latest_deploy_status
  if body_pagination_page_size is not None:
    flat_body["pagination_page_size"] = body_pagination_page_size
  if body_pagination_page is not None:
    flat_body["pagination_page"] = body_pagination_page
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/services/search", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
