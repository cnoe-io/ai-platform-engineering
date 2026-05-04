"""Tools for /global/spend/report operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_global_get(
  param_start_date: str | None = None,
  param_end_date: str | None = None,
  param_group_by: str | None = None,
  param_api_key: str | None = None,
  param_internal_user_id: str | None = None,
  param_team_id: str | None = None,
  param_customer_id: str | None = None,
) -> Any:
  """
      Get Global Spend Report

      OpenAPI Description:
          Get Daily Spend per Team, based on specific startTime and endTime. Per team, view usage by each key, model
  [
      {
          "group-by-day": "2024-05-10",
          "teams": [
              {
                  "team_name": "team-1"
                  "spend": 10,
                  "keys": [
                      "key": "1213",
                      "usage": {
                          "model-1": {
                                  "cost": 12.50,
                                  "input_tokens": 1000,
                                  "output_tokens": 5000,
                                  "requests": 100
                              },
                              "audio-modelname1": {
                              "cost": 25.50,
                              "seconds": 25,
                              "requests": 50
                      },
                      }
                  }
          ]
      ]
  }

      Args:

          param_start_date (str): Time from which to start viewing spend

          param_end_date (str): Time till which to view spend

          param_group_by (str): Group spend by internal team or customer or api_key

          param_api_key (str): View spend for a specific api_key. Example api_key='sk-1234

          param_internal_user_id (str): View spend for a specific internal_user_id. Example internal_user_id='1234

          param_team_id (str): View spend for a specific team_id. Example team_id='1234

          param_customer_id (str): View spend for a specific customer_id. Example customer_id='1234. Can be used in conjunction with team_id as well.


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /global/spend/report")

  params = {}
  data = {}

  if param_start_date is not None:
    params["start_date"] = str(param_start_date).lower() if isinstance(param_start_date, bool) else param_start_date

  if param_end_date is not None:
    params["end_date"] = str(param_end_date).lower() if isinstance(param_end_date, bool) else param_end_date

  if param_group_by is not None:
    params["group_by"] = str(param_group_by).lower() if isinstance(param_group_by, bool) else param_group_by

  if param_api_key is not None:
    params["api_key"] = str(param_api_key).lower() if isinstance(param_api_key, bool) else param_api_key

  if param_internal_user_id is not None:
    params["internal_user_id"] = str(param_internal_user_id).lower() if isinstance(param_internal_user_id, bool) else param_internal_user_id

  if param_team_id is not None:
    params["team_id"] = str(param_team_id).lower() if isinstance(param_team_id, bool) else param_team_id

  if param_customer_id is not None:
    params["customer_id"] = str(param_customer_id).lower() if isinstance(param_customer_id, bool) else param_customer_id

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/global/spend/report", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
