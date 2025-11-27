"""Tools for /api/v2/audit-log operations"""

import logging
from typing import Any, List, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_api_v2_audit_log(
  param_id: Optional[str] = None,
  param_user_ids: Optional[List[str]] = None,
  param_actions: Optional[List[str]] = None,
  param_categories: Optional[List[str]] = None,
  param_operations: Optional[List[str]] = None,
  param_entity_types: Optional[List[str]] = None,
  param_entity_name: Optional[str] = None,
  param_start_time: Optional[str] = None,
  param_end_time: Optional[str] = None,
  param_status: Optional[str] = None,
  param_page: Optional[int] = None,
  param_page_size: Optional[int] = None,
  param_sort: Optional[str] = None,
) -> Any:
  """
  Query Audit Logs

  OpenAPI Description:
      Query audit logs with filters, sort and pagination. Use `Accept: text/csv` header to get the response as CSV file.


  Args:

      param_id (str): Audit log id. If not provided, the default is all ids.


      param_user_ids (List[str]): OpenAPI parameter corresponding to 'param_user_ids'

      param_actions (List[str]): OpenAPI parameter corresponding to 'param_actions'

      param_categories (List[str]): OpenAPI parameter corresponding to 'param_categories'

      param_operations (List[str]): OpenAPI parameter corresponding to 'param_operations'

      param_entity_types (List[str]): OpenAPI parameter corresponding to 'param_entity_types'

      param_entity_name (str): OpenAPI parameter corresponding to 'param_entity_name'

      param_start_time (str): Start time of the audit logs query. If not provided, the default is 8 hours ago. Start time parameter is ignored if the response is CSV.


      param_end_time (str): End time of the audit logs query. If not provided, the default is now. End time parameter is ignored if the response is CSV.


      param_status (str): Status of the audit logs query. If not provided, the default is all statuses.


      param_page (int): Page number. If not provided, the default is 1. Page parameter is ignored if the response is CSV.


      param_page_size (int): Page size. If not provided, the default is 20. Page size parameter is ignored if the response is CSV.


      param_sort (str): OpenAPI parameter corresponding to 'param_sort'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/audit-log")

  params = {}
  data = {}

  if param_id is not None:
    params["id"] = str(param_id).lower() if isinstance(param_id, bool) else param_id

  if param_user_ids is not None:
    params["user_ids"] = str(param_user_ids).lower() if isinstance(param_user_ids, bool) else param_user_ids

  if param_actions is not None:
    params["actions"] = str(param_actions).lower() if isinstance(param_actions, bool) else param_actions

  if param_categories is not None:
    params["categories"] = str(param_categories).lower() if isinstance(param_categories, bool) else param_categories

  if param_operations is not None:
    params["operations"] = str(param_operations).lower() if isinstance(param_operations, bool) else param_operations

  if param_entity_types is not None:
    params["entity_types"] = str(param_entity_types).lower() if isinstance(param_entity_types, bool) else param_entity_types

  if param_entity_name is not None:
    params["entity_name"] = str(param_entity_name).lower() if isinstance(param_entity_name, bool) else param_entity_name

  if param_start_time is not None:
    params["start_time"] = str(param_start_time).lower() if isinstance(param_start_time, bool) else param_start_time

  if param_end_time is not None:
    params["end_time"] = str(param_end_time).lower() if isinstance(param_end_time, bool) else param_end_time

  if param_status is not None:
    params["status"] = str(param_status).lower() if isinstance(param_status, bool) else param_status

  if param_page is not None:
    params["page"] = str(param_page).lower() if isinstance(param_page, bool) else param_page

  if param_page_size is not None:
    params["page_size"] = str(param_page_size).lower() if isinstance(param_page_size, bool) else param_page_size

  if param_sort is not None:
    params["sort"] = str(param_sort).lower() if isinstance(param_sort, bool) else param_sort

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/audit-log", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
