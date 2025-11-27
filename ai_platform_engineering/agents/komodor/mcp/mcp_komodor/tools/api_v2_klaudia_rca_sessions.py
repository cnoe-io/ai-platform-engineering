"""Tools for /api/v2/klaudia/rca/sessions operations"""

import logging
from typing import Any, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def post_trigger_klaudia_rca(
  body_kind: str, body_name: str, body_namespace: str, body_cluster_name: str, body_issue_id: Optional[str] = None
) -> Any:
  """
  Trigger a new RCA investigation

  OpenAPI Description:
      IMPORTANT: Cluster name is REQUIRED for RCA investigations. If you don't have the cluster name,
      first search for the service using post_api_v2_svcs_search to discover it.

  Args:

      body_kind (str): The Kubernetes resource kind (e.g., 'Deployment', 'StatefulSet')

      body_name (str): The name of the resource

      body_namespace (str): The namespace of the resource

      body_cluster_name (str): REQUIRED - The cluster name where the resource is located

      body_issue_id (str): Optional issue ID to associate with the RCA


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  # Validate required cluster_name parameter
  if not body_cluster_name:
    error_msg = "Cluster name is required for RCA investigations. Please provide the cluster name or search for the service first to discover it."
    logger.error(error_msg)
    return {"error": error_msg}
  
  logger.debug("Making POST request to /api/v2/klaudia/rca/sessions")

  params = {}
  data = {}

  flat_body = {}
  if body_kind is not None:
    flat_body["kind"] = body_kind
  if body_name is not None:
    flat_body["name"] = body_name
  if body_namespace is not None:
    flat_body["namespace"] = body_namespace
  if body_cluster_name is not None:
    flat_body["cluster_name"] = body_cluster_name
  if body_issue_id is not None:
    flat_body["issue_id"] = body_issue_id
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/klaudia/rca/sessions", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
