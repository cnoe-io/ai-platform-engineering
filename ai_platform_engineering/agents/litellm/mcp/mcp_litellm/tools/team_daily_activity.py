"""Tools for /team/daily/activity operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_team_get(
  param_team_ids: str | None = None,
  param_start_date: str | None = None,
  param_end_date: str | None = None,
  param_model: str | None = None,
  param_api_key: str | None = None,
  param_page: int | None = None,
  param_page_size: int | None = None,
  param_exclude_team_ids: str | None = None,
) -> Any:
  """
      Get Team Daily Activity

      OpenAPI Description:
          Get daily activity for specific teams or all teams.

  Args:
      team_ids (Optional[str]): Comma-separated list of team IDs to filter by. If not provided, returns data for all teams.
      start_date (Optional[str]): Start date for the activity period (YYYY-MM-DD).
      end_date (Optional[str]): End date for the activity period (YYYY-MM-DD).
      model (Optional[str]): Filter by model name.
      api_key (Optional[str]): Filter by API key.
      page (int): Page number for pagination.
      page_size (int): Number of items per page.
      exclude_team_ids (Optional[str]): Comma-separated list of team IDs to exclude.
  Returns:
      SpendAnalyticsPaginatedResponse: Paginated response containing daily activity data.

      Args:

          param_team_ids (str): OpenAPI parameter corresponding to 'param_team_ids'

          param_start_date (str): OpenAPI parameter corresponding to 'param_start_date'

          param_end_date (str): OpenAPI parameter corresponding to 'param_end_date'

          param_model (str): OpenAPI parameter corresponding to 'param_model'

          param_api_key (str): OpenAPI parameter corresponding to 'param_api_key'

          param_page (int): OpenAPI parameter corresponding to 'param_page'

          param_page_size (int): OpenAPI parameter corresponding to 'param_page_size'

          param_exclude_team_ids (str): OpenAPI parameter corresponding to 'param_exclude_team_ids'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /team/daily/activity")

  params = {}
  data = {}

  if param_team_ids is not None:
    params["team_ids"] = str(param_team_ids).lower() if isinstance(param_team_ids, bool) else param_team_ids

  if param_start_date is not None:
    params["start_date"] = str(param_start_date).lower() if isinstance(param_start_date, bool) else param_start_date

  if param_end_date is not None:
    params["end_date"] = str(param_end_date).lower() if isinstance(param_end_date, bool) else param_end_date

  if param_model is not None:
    params["model"] = str(param_model).lower() if isinstance(param_model, bool) else param_model

  if param_api_key is not None:
    params["api_key"] = str(param_api_key).lower() if isinstance(param_api_key, bool) else param_api_key

  if param_page is not None:
    params["page"] = str(param_page).lower() if isinstance(param_page, bool) else param_page

  if param_page_size is not None:
    params["page_size"] = str(param_page_size).lower() if isinstance(param_page_size, bool) else param_page_size

  if param_exclude_team_ids is not None:
    params["exclude_team_ids"] = str(param_exclude_team_ids).lower() if isinstance(param_exclude_team_ids, bool) else param_exclude_team_ids

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/team/daily/activity", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
