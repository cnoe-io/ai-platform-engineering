"""Tools for /guardrails/submissions operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_ls_guardrail_get(param_status: str | None = None, param_team_id: str | None = None, param_search: str | None = None) -> Any:
  """
      List Guardrail Submissions

      OpenAPI Description:
          List team guardrail submissions. Returns only guardrails with a team_id.

  Admins see all submissions. Non-admin users see submissions for teams they are
  a member of.

  Status values: pending_review (team-registered, awaiting approval), active (approved), rejected.

  Optional filters:
  - status: pending_review | active | rejected
  - team_id: filter by specific team (non-admins must be a member of that team)
  - search: name/description

      Args:

          param_status (str): OpenAPI parameter corresponding to 'param_status'

          param_team_id (str): OpenAPI parameter corresponding to 'param_team_id'

          param_search (str): OpenAPI parameter corresponding to 'param_search'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /guardrails/submissions")

  params = {}
  data = {}

  if param_status is not None:
    params["status"] = str(param_status).lower() if isinstance(param_status, bool) else param_status

  if param_team_id is not None:
    params["team_id"] = str(param_team_id).lower() if isinstance(param_team_id, bool) else param_team_id

  if param_search is not None:
    params["search"] = str(param_search).lower() if isinstance(param_search, bool) else param_search

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/guardrails/submissions", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
