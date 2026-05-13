"""Tools for /budget/settings operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_budget_settings_get(param_budget_id: str) -> Any:
  """
      Budget Settings

      OpenAPI Description:
          Get list of configurable params + current value for a budget item + description of each field

  Used on Admin UI.

  Query Parameters:
  - budget_id: str - The budget id to get information for

      Args:

          param_budget_id (str): OpenAPI parameter corresponding to 'param_budget_id'


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /budget/settings")

  params = {}
  data = {}

  if param_budget_id is not None:
    params["budget_id"] = str(param_budget_id).lower() if isinstance(param_budget_id, bool) else param_budget_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/budget/settings", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
