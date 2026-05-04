"""Tools for /key/aliases operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_key_aliases_key_aliases_get(
  param_page: int | None = None, param_size: int | None = None, param_search: str | None = None, param_team_id: str | None = None
) -> Any:
  """
      Key Aliases

      OpenAPI Description:
          Lists key aliases with pagination and optional search.

  Non-admin users only see aliases for keys they own or keys belonging to
  their teams.

  Returns:
      {
          "aliases": List[str],
          "total_count": int,
          "current_page": int,
          "total_pages": int,
          "size": int,
      }

      Args:

          param_page (int): Page number

          param_size (int): Page size

          param_search (str): Search key aliases (case-insensitive partial match)

          param_team_id (str): Filter aliases to keys belonging to this team


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /key/aliases")

  params = {}
  data = {}

  if param_page is not None:
    params["page"] = str(param_page).lower() if isinstance(param_page, bool) else param_page

  if param_size is not None:
    params["size"] = str(param_size).lower() if isinstance(param_size, bool) else param_size

  if param_search is not None:
    params["search"] = str(param_search).lower() if isinstance(param_search, bool) else param_search

  if param_team_id is not None:
    params["team_id"] = str(param_team_id).lower() if isinstance(param_team_id, bool) else param_team_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/key/aliases", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
