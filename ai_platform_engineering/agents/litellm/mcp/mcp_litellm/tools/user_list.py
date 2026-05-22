"""Tools for /user/list operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_users_user_ls_get(
  param_role: str | None = None,
  param_user_ids: str | None = None,
  param_sso_user_ids: str | None = None,
  param_user_email: str | None = None,
  param_team: str | None = None,
  param_page: int | None = None,
  param_page_size: int | None = None,
  param_sort_by: str | None = None,
  param_sort_order: str | None = None,
  param_organization_ids: str | None = None,
) -> Any:
  """
      Get Users

      OpenAPI Description:
          Get a paginated list of users with filtering and sorting options.

  Parameters:
      role: Optional[str]
          Filter users by role. Can be one of:
          - proxy_admin
          - proxy_admin_viewer
          - internal_user
          - internal_user_viewer
      user_ids: Optional[str]
          Get list of users by user_ids. Comma separated list of user_ids.
      sso_ids: Optional[str]
          Get list of users by sso_ids. Comma separated list of sso_ids.
      user_email: Optional[str]
          Filter users by partial email match
      team: Optional[str]
          Filter users by team id. Will match if user has this team in their teams array.
      page: int
          The page number to return
      page_size: int
          The number of items per page
      sort_by: Optional[str]
          Column to sort by (e.g. 'user_id', 'user_email', 'created_at', 'spend')
      sort_order: Optional[str]
          Sort order ('asc' or 'desc')

      Args:

          param_role (str): Filter users by role

          param_user_ids (str): Get list of users by user_ids

          param_sso_user_ids (str): Get list of users by sso_user_id

          param_user_email (str): Filter users by partial email match

          param_team (str): Filter users by team id

          param_page (int): Page number

          param_page_size (int): Number of items per page

          param_sort_by (str): Column to sort by (e.g. 'user_id', 'user_email', 'created_at', 'spend')

          param_sort_order (str): Sort order ('asc' or 'desc')

          param_organization_ids (str): Filter users by organization membership. Comma-separated list of org IDs.


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /user/list")

  params = {}
  data = {}

  if param_role is not None:
    params["role"] = str(param_role).lower() if isinstance(param_role, bool) else param_role

  if param_user_ids is not None:
    params["user_ids"] = str(param_user_ids).lower() if isinstance(param_user_ids, bool) else param_user_ids

  if param_sso_user_ids is not None:
    params["sso_user_ids"] = str(param_sso_user_ids).lower() if isinstance(param_sso_user_ids, bool) else param_sso_user_ids

  if param_user_email is not None:
    params["user_email"] = str(param_user_email).lower() if isinstance(param_user_email, bool) else param_user_email

  if param_team is not None:
    params["team"] = str(param_team).lower() if isinstance(param_team, bool) else param_team

  if param_page is not None:
    params["page"] = str(param_page).lower() if isinstance(param_page, bool) else param_page

  if param_page_size is not None:
    params["page_size"] = str(param_page_size).lower() if isinstance(param_page_size, bool) else param_page_size

  if param_sort_by is not None:
    params["sort_by"] = str(param_sort_by).lower() if isinstance(param_sort_by, bool) else param_sort_by

  if param_sort_order is not None:
    params["sort_order"] = str(param_sort_order).lower() if isinstance(param_sort_order, bool) else param_sort_order

  if param_organization_ids is not None:
    params["organization_ids"] = str(param_organization_ids).lower() if isinstance(param_organization_ids, bool) else param_organization_ids

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/user/list", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
