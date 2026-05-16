"""Tools for /user/daily/activity operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_user_get(
  param_start_date: str | None = None,
  param_end_date: str | None = None,
  param_model: str | None = None,
  param_api_key: str | None = None,
  param_user_id: str | None = None,
  param_page: int | None = None,
  param_page_size: int | None = None,
  param_timezone: str | None = None,
) -> Any:
  """
      Get User Daily Activity

      OpenAPI Description:
          [BETA] This is a beta endpoint. It will change.

  Meant to optimize querying spend data for analytics for a user.

  Returns:
  (by date)
  - spend
  - prompt_tokens
  - completion_tokens
  - cache_read_input_tokens
  - cache_creation_input_tokens
  - total_tokens
  - api_requests
  - breakdown by model, api_key, provider

      Args:

          param_start_date (str): Start date in YYYY-MM-DD format

          param_end_date (str): End date in YYYY-MM-DD format

          param_model (str): Filter by specific model

          param_api_key (str): Filter by specific API key

          param_user_id (str): Filter by specific user ID. Admins can filter by any user or omit for global view. Non-admins must provide their own user_id.

          param_page (int): Page number for pagination

          param_page_size (int): Items per page

          param_timezone (str): Timezone offset in minutes from UTC (e.g., 480 for PST). Matches JavaScript's Date.getTimezoneOffset() convention.


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /user/daily/activity")

  params = {}
  data = {}

  if param_start_date is not None:
    params["start_date"] = str(param_start_date).lower() if isinstance(param_start_date, bool) else param_start_date

  if param_end_date is not None:
    params["end_date"] = str(param_end_date).lower() if isinstance(param_end_date, bool) else param_end_date

  if param_model is not None:
    params["model"] = str(param_model).lower() if isinstance(param_model, bool) else param_model

  if param_api_key is not None:
    params["api_key"] = str(param_api_key).lower() if isinstance(param_api_key, bool) else param_api_key

  if param_user_id is not None:
    params["user_id"] = str(param_user_id).lower() if isinstance(param_user_id, bool) else param_user_id

  if param_page is not None:
    params["page"] = str(param_page).lower() if isinstance(param_page, bool) else param_page

  if param_page_size is not None:
    params["page_size"] = str(param_page_size).lower() if isinstance(param_page_size, bool) else param_page_size

  if param_timezone is not None:
    params["timezone"] = str(param_timezone).lower() if isinstance(param_timezone, bool) else param_timezone

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/user/daily/activity", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
