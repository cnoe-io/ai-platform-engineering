"""Tools for /api/v2/klaudia/rca/sessions operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def post_trigger_klaudia_rca(
  body_kind: str, body_name: str, body_namespace: str, body_cluster_name: str, body_issue_id: str = None
) -> Any:
  """
  Trigger a new RCA investigation

  OpenAPI Description:


  Args:

      body_kind (str): OpenAPI parameter corresponding to 'body_kind'

      body_name (str): OpenAPI parameter corresponding to 'body_name'

      body_namespace (str): OpenAPI parameter corresponding to 'body_namespace'

      body_cluster_name (str): OpenAPI parameter corresponding to 'body_cluster_name'

      body_issue_id (str): OpenAPI parameter corresponding to 'body_issue_id'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
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
