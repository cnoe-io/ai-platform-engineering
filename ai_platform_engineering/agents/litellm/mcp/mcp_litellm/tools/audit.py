"""Tools for /audit operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_audit_logs_audit_get(
  param_page: int | None = None,
  param_page_size: int | None = None,
  param_changed_by: str | None = None,
  param_changed_by_api_key: str | None = None,
  param_action: str | None = None,
  param_table_name: str | None = None,
  param_object_id: str | None = None,
  param_start_date: str | None = None,
  param_end_date: str | None = None,
  param_object_team_id: str | None = None,
  param_object_key_hash: str | None = None,
  param_sort_by: str | None = None,
  param_sort_order: str | None = None,
) -> Any:
  """
      Get Audit Logs

      OpenAPI Description:
          Get all audit logs with filtering and pagination.

  Returns a paginated response of audit logs matching the specified filters.

  Note: object_team_id and object_key_hash use Prisma JSON path filtering,
  which requires PostgreSQL.

      Args:

          param_page (int): OpenAPI parameter corresponding to 'param_page'

          param_page_size (int): OpenAPI parameter corresponding to 'param_page_size'

          param_changed_by (str): Filter by user or system that performed the action

          param_changed_by_api_key (str): Filter by API key hash that performed the action

          param_action (str): Filter by action type (create, update, delete)

          param_table_name (str): Filter by table name that was modified

          param_object_id (str): Filter by ID of the object that was modified

          param_start_date (str): Filter logs after this date

          param_end_date (str): Filter logs before this date

          param_object_team_id (str): Filter by team_id present in before_value or updated_values JSON (PostgreSQL only)

          param_object_key_hash (str): Filter by token (key hash) present in before_value or updated_values JSON (PostgreSQL only)

          param_sort_by (str): Column to sort by (e.g. 'updated_at', 'action', 'table_name')

          param_sort_order (str): Sort order ('asc' or 'desc')


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /audit")

  params = {}
  data = {}

  if param_page is not None:
    params["page"] = str(param_page).lower() if isinstance(param_page, bool) else param_page

  if param_page_size is not None:
    params["page_size"] = str(param_page_size).lower() if isinstance(param_page_size, bool) else param_page_size

  if param_changed_by is not None:
    params["changed_by"] = str(param_changed_by).lower() if isinstance(param_changed_by, bool) else param_changed_by

  if param_changed_by_api_key is not None:
    params["changed_by_api_key"] = (
      str(param_changed_by_api_key).lower() if isinstance(param_changed_by_api_key, bool) else param_changed_by_api_key
    )

  if param_action is not None:
    params["action"] = str(param_action).lower() if isinstance(param_action, bool) else param_action

  if param_table_name is not None:
    params["table_name"] = str(param_table_name).lower() if isinstance(param_table_name, bool) else param_table_name

  if param_object_id is not None:
    params["object_id"] = str(param_object_id).lower() if isinstance(param_object_id, bool) else param_object_id

  if param_start_date is not None:
    params["start_date"] = str(param_start_date).lower() if isinstance(param_start_date, bool) else param_start_date

  if param_end_date is not None:
    params["end_date"] = str(param_end_date).lower() if isinstance(param_end_date, bool) else param_end_date

  if param_object_team_id is not None:
    params["object_team_id"] = str(param_object_team_id).lower() if isinstance(param_object_team_id, bool) else param_object_team_id

  if param_object_key_hash is not None:
    params["object_key_hash"] = str(param_object_key_hash).lower() if isinstance(param_object_key_hash, bool) else param_object_key_hash

  if param_sort_by is not None:
    params["sort_by"] = str(param_sort_by).lower() if isinstance(param_sort_by, bool) else param_sort_by

  if param_sort_order is not None:
    params["sort_order"] = str(param_sort_order).lower() if isinstance(param_sort_order, bool) else param_sort_order

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/audit", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
