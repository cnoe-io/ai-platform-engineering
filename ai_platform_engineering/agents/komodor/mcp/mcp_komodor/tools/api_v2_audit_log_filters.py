"""Tools for /api/v2/audit-log/filters operations"""

import logging
from typing import Any
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_audit_log_filters(param_start_time: str = None, param_end_time: str = None) -> Any:
  """
  Get available filter values for Query Audit Logs

  OpenAPI Description:


  Args:

      param_start_time (str): Start time of the audit logs filters. If not provided, the default is 8 hours ago.


      param_end_time (str): End time of the audit logs filters. If not provided, the default is now.



  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/audit-log/filters")

  params = {}
  data = {}

  if param_start_time is not None:
    params["start_time"] = str(param_start_time).lower() if isinstance(param_start_time, bool) else param_start_time

  if param_end_time is not None:
    params["end_time"] = str(param_end_time).lower() if isinstance(param_end_time, bool) else param_end_time

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/audit-log/filters", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
