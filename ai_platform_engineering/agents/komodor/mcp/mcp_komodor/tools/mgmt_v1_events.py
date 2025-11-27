"""Tools for /mgmt/v1/events operations"""

import logging
from typing import Dict, Any, List, Literal, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def post_events_controller_event(
  body_event_type: str,
  body_summary: str,
  body_scope_clusters: Optional[List[str]] = None,
  body_scope_services_names: Optional[List[str]] = None,
  body_scope_namespaces: Optional[List[str]] = None,
  body_severity: Literal["information", "warning", "error"] = None,
  body_details: Dict[str, Any] = None,
) -> Any:
  """


  OpenAPI Description:


  Args:

      body_event_type (str): Required. The type of event you'd like to create, limited to 30 characters.

      body_summary (str): Required. Description of the event.

      body_scope_clusters (List[str]): List of cluster identifiers.

      body_scope_services_names (List[str]): List of service names.

      body_scope_namespaces (List[str]): List of namespaces.

      body_severity (Literal['information', 'warning', 'error']): Optional. Severity level of the event. Defaults to 'information'.

      body_details (Dict[str, Any]): Optional. Additional key-value pairs for extra event details.


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making POST request to /mgmt/v1/events")

  params = {}
  data = {}

  flat_body = {}
  if body_event_type is not None:
    flat_body["event_type"] = body_event_type
  if body_summary is not None:
    flat_body["summary"] = body_summary
  if body_scope_clusters is not None:
    flat_body["scope_clusters"] = body_scope_clusters
  if body_scope_services_names is not None:
    flat_body["scope_services_names"] = body_scope_services_names
  if body_scope_namespaces is not None:
    flat_body["scope_namespaces"] = body_scope_namespaces
  if body_severity is not None:
    flat_body["severity"] = body_severity
  if body_details is not None:
    flat_body["details"] = body_details
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/mgmt/v1/events", method="POST", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
