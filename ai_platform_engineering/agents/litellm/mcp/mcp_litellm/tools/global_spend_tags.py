"""Tools for /global/spend/tags operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_global_view_get(param_start_date: str | None = None, param_end_date: str | None = None, param_tags: str | None = None) -> Any:
  """
      Global View Spend Tags

      OpenAPI Description:
          LiteLLM Enterprise - View Spend Per Request Tag. Used by LiteLLM UI

  Example Request:
  ```
  curl -X GET "http://0.0.0.0:4000/spend/tags" -H "Authorization: Bearer <litellm-api-key>"
  ```

  Spend with Start Date and End Date
  ```
  curl -X GET "http://0.0.0.0:4000/spend/tags?start_date=2022-01-01&end_date=2022-02-01" -H "Authorization: Bearer <litellm-api-key>"
  ```

      Args:

          param_start_date (str): Time from which to start viewing key spend

          param_end_date (str): Time till which to view key spend

          param_tags (str): comman separated tags to filter on


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /global/spend/tags")

  params = {}
  data = {}

  if param_start_date is not None:
    params["start_date"] = str(param_start_date).lower() if isinstance(param_start_date, bool) else param_start_date

  if param_end_date is not None:
    params["end_date"] = str(param_end_date).lower() if isinstance(param_end_date, bool) else param_end_date

  if param_tags is not None:
    params["tags"] = str(param_tags).lower() if isinstance(param_tags, bool) else param_tags

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/global/spend/tags", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
