"""Tools for /spend/logs/v2 operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ui_view_get(
  param_api_key: str | None = None,
  param_user_id: str | None = None,
  param_request_id: str | None = None,
  param_team_id: str | None = None,
  param_min_spend: str | None = None,
  param_max_spend: str | None = None,
  param_start_date: str | None = None,
  param_end_date: str | None = None,
  param_page: int | None = None,
  param_page_size: int | None = None,
  param_status_filter: str | None = None,
  param_model: str | None = None,
  param_model_id: str | None = None,
  param_key_alias: str | None = None,
  param_end_user: str | None = None,
  param_error_code: str | None = None,
  param_error_message: str | None = None,
  param_sort_by: str | None = None,
  param_sort_order: str | None = None,
) -> Any:
  """
      Ui View Spend Logs

      OpenAPI Description:
          View spend logs with pagination support.
  Available at both `/spend/logs/v2` (public API) and `/spend/logs/ui` (internal UI).

  Returns paginated response with data, total, page, page_size, and total_pages.

  Example:
  ```
  curl -X GET "http://0.0.0.0:8000/spend/logs/v2?start_date=2025-11-25%2000:00:00&end_date=2025-11-26%2023:59:59&page=1&page_size=50" -H "Authorization: Bearer <litellm-api-key>"
  ```

      Args:

          param_api_key (str): Get spend logs based on api key

          param_user_id (str): Get spend logs based on user_id

          param_request_id (str): request_id to get spend logs for specific request_id

          param_team_id (str): Filter spend logs by team_id

          param_min_spend (str): Filter logs with spend greater than or equal to this value

          param_max_spend (str): Filter logs with spend less than or equal to this value

          param_start_date (str): Time from which to start viewing key spend

          param_end_date (str): Time till which to view key spend

          param_page (int): Page number for pagination

          param_page_size (int): Number of items per page

          param_status_filter (str): Filter logs by status (e.g., success, failure)

          param_model (str): Filter logs by model

          param_model_id (str): Filter logs by model ID (litellm model deployment id)

          param_key_alias (str): Filter logs by key alias

          param_end_user (str): Filter logs by end user

          param_error_code (str): Filter logs by error code (e.g., '404', '500')

          param_error_message (str): Filter logs by error message (partial string match)

          param_sort_by (str): Sort logs by field: spend, total_tokens, startTime, or endTime

          param_sort_order (str): Sort order: asc or desc


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /spend/logs/v2")

  params = {}
  data = {}

  if param_api_key is not None:
    params["api_key"] = str(param_api_key).lower() if isinstance(param_api_key, bool) else param_api_key

  if param_user_id is not None:
    params["user_id"] = str(param_user_id).lower() if isinstance(param_user_id, bool) else param_user_id

  if param_request_id is not None:
    params["request_id"] = str(param_request_id).lower() if isinstance(param_request_id, bool) else param_request_id

  if param_team_id is not None:
    params["team_id"] = str(param_team_id).lower() if isinstance(param_team_id, bool) else param_team_id

  if param_min_spend is not None:
    params["min_spend"] = str(param_min_spend).lower() if isinstance(param_min_spend, bool) else param_min_spend

  if param_max_spend is not None:
    params["max_spend"] = str(param_max_spend).lower() if isinstance(param_max_spend, bool) else param_max_spend

  if param_start_date is not None:
    params["start_date"] = str(param_start_date).lower() if isinstance(param_start_date, bool) else param_start_date

  if param_end_date is not None:
    params["end_date"] = str(param_end_date).lower() if isinstance(param_end_date, bool) else param_end_date

  if param_page is not None:
    params["page"] = str(param_page).lower() if isinstance(param_page, bool) else param_page

  if param_page_size is not None:
    params["page_size"] = str(param_page_size).lower() if isinstance(param_page_size, bool) else param_page_size

  if param_status_filter is not None:
    params["status_filter"] = str(param_status_filter).lower() if isinstance(param_status_filter, bool) else param_status_filter

  if param_model is not None:
    params["model"] = str(param_model).lower() if isinstance(param_model, bool) else param_model

  if param_model_id is not None:
    params["model_id"] = str(param_model_id).lower() if isinstance(param_model_id, bool) else param_model_id

  if param_key_alias is not None:
    params["key_alias"] = str(param_key_alias).lower() if isinstance(param_key_alias, bool) else param_key_alias

  if param_end_user is not None:
    params["end_user"] = str(param_end_user).lower() if isinstance(param_end_user, bool) else param_end_user

  if param_error_code is not None:
    params["error_code"] = str(param_error_code).lower() if isinstance(param_error_code, bool) else param_error_code

  if param_error_message is not None:
    params["error_message"] = str(param_error_message).lower() if isinstance(param_error_message, bool) else param_error_message

  if param_sort_by is not None:
    params["sort_by"] = str(param_sort_by).lower() if isinstance(param_sort_by, bool) else param_sort_by

  if param_sort_order is not None:
    params["sort_order"] = str(param_sort_order).lower() if isinstance(param_sort_order, bool) else param_sort_order

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/spend/logs/v2", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
