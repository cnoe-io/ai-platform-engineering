"""Tools for /spend/tags operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_view_spend_tags_spend_tags_get(param_start_date: str | None = None, param_end_date: str | None = None) -> Any:
  """
      View Spend Tags

      OpenAPI Description:
          LiteLLM Enterprise - View Spend Per Request Tag

  Example Request:
  ```
  curl -X GET "http://0.0.0.0:8000/spend/tags" -H "Authorization: Bearer <litellm-api-key>"
  ```

  Spend with Start Date and End Date
  ```
  curl -X GET "http://0.0.0.0:8000/spend/tags?start_date=2022-01-01&end_date=2022-02-01" -H "Authorization: Bearer <litellm-api-key>"
  ```

      Args:

          param_start_date (str): Time from which to start viewing key spend

          param_end_date (str): Time till which to view key spend


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /spend/tags")

  params = {}
  data = {}

  if param_start_date is not None:
    params["start_date"] = str(param_start_date).lower() if isinstance(param_start_date, bool) else param_start_date

  if param_end_date is not None:
    params["end_date"] = str(param_end_date).lower() if isinstance(param_end_date, bool) else param_end_date

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/spend/tags", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
