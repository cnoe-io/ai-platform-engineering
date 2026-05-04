"""Tools for /key/list operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_keys_key_ls_get(
  param_page: int | None = None,
  param_size: int | None = None,
  param_user_id: str | None = None,
  param_team_id: str | None = None,
  param_organization_id: str | None = None,
  param_key_hash: str | None = None,
  param_key_alias: str | None = None,
  param_return_full_object: bool | None = None,
  param_include_team_keys: bool | None = None,
  param_include_created_by_keys: bool | None = None,
  param_sort_by: str | None = None,
  param_sort_order: str | None = None,
  param_expand: str | None = None,
  param_status: str | None = None,
  param_project_id: str | None = None,
  param_access_group_id: str | None = None,
) -> Any:
  """
      List Keys

      OpenAPI Description:
          List all keys for a given user / team / organization.

  Parameters:
      expand: Optional[List[str]] - Expand related objects (e.g. 'user' to include user information)
      status: Optional[str] - Filter by status. Currently supports "deleted" to query deleted keys.

  Returns:
      {
          "keys": List[str] or List[UserAPIKeyAuth],
          "total_count": int,
          "current_page": int,
          "total_pages": int,
      }

  When expand includes "user", each key object will include a "user" field with the associated user object.
  Note: When expand=user is specified, full key objects are returned regardless of the return_full_object parameter.

      Args:

          param_page (int): Page number

          param_size (int): Page size

          param_user_id (str): Filter keys by user ID. Supports partial matching (substring, case-insensitive).

          param_team_id (str): Filter keys by team ID

          param_organization_id (str): Filter keys by organization ID

          param_key_hash (str): Filter keys by key hash

          param_key_alias (str): Filter keys by key alias. Supports partial matching (substring, case-insensitive).

          param_return_full_object (bool): Return full key object

          param_include_team_keys (bool): Include all keys for teams that user is an admin of.

          param_include_created_by_keys (bool): Include keys created by the user

          param_sort_by (str): Column to sort by (e.g. 'user_id', 'created_at', 'spend')

          param_sort_order (str): Sort order ('asc' or 'desc')

          param_expand (str): Expand related objects (e.g. 'user')

          param_status (str): Filter by status (e.g. 'deleted')

          param_project_id (str): Filter keys by project ID

          param_access_group_id (str): Filter keys by access group ID


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /key/list")

  params = {}
  data = {}

  if param_page is not None:
    params["page"] = str(param_page).lower() if isinstance(param_page, bool) else param_page

  if param_size is not None:
    params["size"] = str(param_size).lower() if isinstance(param_size, bool) else param_size

  if param_user_id is not None:
    params["user_id"] = str(param_user_id).lower() if isinstance(param_user_id, bool) else param_user_id

  if param_team_id is not None:
    params["team_id"] = str(param_team_id).lower() if isinstance(param_team_id, bool) else param_team_id

  if param_organization_id is not None:
    params["organization_id"] = str(param_organization_id).lower() if isinstance(param_organization_id, bool) else param_organization_id

  if param_key_hash is not None:
    params["key_hash"] = str(param_key_hash).lower() if isinstance(param_key_hash, bool) else param_key_hash

  if param_key_alias is not None:
    params["key_alias"] = str(param_key_alias).lower() if isinstance(param_key_alias, bool) else param_key_alias

  if param_return_full_object is not None:
    params["return_full_object"] = (
      str(param_return_full_object).lower() if isinstance(param_return_full_object, bool) else param_return_full_object
    )

  if param_include_team_keys is not None:
    params["include_team_keys"] = (
      str(param_include_team_keys).lower() if isinstance(param_include_team_keys, bool) else param_include_team_keys
    )

  if param_include_created_by_keys is not None:
    params["include_created_by_keys"] = (
      str(param_include_created_by_keys).lower() if isinstance(param_include_created_by_keys, bool) else param_include_created_by_keys
    )

  if param_sort_by is not None:
    params["sort_by"] = str(param_sort_by).lower() if isinstance(param_sort_by, bool) else param_sort_by

  if param_sort_order is not None:
    params["sort_order"] = str(param_sort_order).lower() if isinstance(param_sort_order, bool) else param_sort_order

  if param_expand is not None:
    params["expand"] = str(param_expand).lower() if isinstance(param_expand, bool) else param_expand

  if param_status is not None:
    params["status"] = str(param_status).lower() if isinstance(param_status, bool) else param_status

  if param_project_id is not None:
    params["project_id"] = str(param_project_id).lower() if isinstance(param_project_id, bool) else param_project_id

  if param_access_group_id is not None:
    params["access_group_id"] = str(param_access_group_id).lower() if isinstance(param_access_group_id, bool) else param_access_group_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/key/list", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
