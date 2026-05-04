"""Tools for /spend/logs operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_view_spend_logs_spend_logs_get(
  param_api_key: str | None = None,
  param_user_id: str | None = None,
  param_request_id: str | None = None,
  param_start_date: str | None = None,
  param_end_date: str | None = None,
  param_summarize: bool | None = None,
) -> Any:
  """
      View Spend Logs

      OpenAPI Description:
          [DEPRECATED] This endpoint is not paginated and can cause performance issues.
  Please use `/spend/logs/v2` instead for paginated access to spend logs.

  View all spend logs, if request_id is provided, only logs for that request_id will be returned

  When start_date and end_date are provided:
  - summarize=true (default): Returns aggregated spend data grouped by date (maintains backward compatibility)
  - summarize=false: Returns filtered individual log entries within the date range

  Example Request for all logs
  ```
  curl -X GET "http://0.0.0.0:8000/spend/logs" -H "Authorization: Bearer <litellm-api-key>"
  ```

  Example Request for specific request_id
  ```
  curl -X GET "http://0.0.0.0:8000/spend/logs?request_id=chatcmpl-6dcb2540-d3d7-4e49-bb27-291f863f112e" -H "Authorization: Bearer <litellm-api-key>"
  ```

  Example Request for specific api_key
  ```
  curl -X GET "http://0.0.0.0:8000/spend/logs?api_key=<litellm-api-key>" -H "Authorization: Bearer <litellm-api-key>"
  ```

  Example Request for specific user_id
  ```
  curl -X GET "http://0.0.0.0:8000/spend/logs?user_id=ishaan@berri.ai" -H "Authorization: Bearer <litellm-api-key>"
  ```

  Example Request for date range with individual logs (unsummarized)
  ```
  curl -X GET "http://0.0.0.0:8000/spend/logs?start_date=2024-01-01&end_date=2024-01-02&summarize=false" -H "Authorization: Bearer <litellm-api-key>"
  ```

      Args:

          param_api_key (str): Get spend logs based on api key

          param_user_id (str): Get spend logs based on user_id

          param_request_id (str): request_id to get spend logs for specific request_id. If none passed then pass spend logs for all requests

          param_start_date (str): Time from which to start viewing key spend

          param_end_date (str): Time till which to view key spend

          param_summarize (bool): When start_date and end_date are provided, summarize=true returns aggregated data by date (legacy behavior), summarize=false returns filtered individual logs


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /spend/logs")

  params = {}
  data = {}

  if param_api_key is not None:
    params["api_key"] = str(param_api_key).lower() if isinstance(param_api_key, bool) else param_api_key

  if param_user_id is not None:
    params["user_id"] = str(param_user_id).lower() if isinstance(param_user_id, bool) else param_user_id

  if param_request_id is not None:
    params["request_id"] = str(param_request_id).lower() if isinstance(param_request_id, bool) else param_request_id

  if param_start_date is not None:
    params["start_date"] = str(param_start_date).lower() if isinstance(param_start_date, bool) else param_start_date

  if param_end_date is not None:
    params["end_date"] = str(param_end_date).lower() if isinstance(param_end_date, bool) else param_end_date

  if param_summarize is not None:
    params["summarize"] = str(param_summarize).lower() if isinstance(param_summarize, bool) else param_summarize

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/spend/logs", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
