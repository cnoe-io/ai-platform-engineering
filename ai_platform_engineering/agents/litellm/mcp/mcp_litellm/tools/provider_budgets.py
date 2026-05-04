"""Tools for /provider/budgets operations"""

import logging
from typing import Any
from mcp_litellm.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_tools")


async def get_provider_budgets_get() -> Any:
  """
      Provider Budgets

      OpenAPI Description:
          Provider Budget Routing - Get Budget, Spend Details https://docs.litellm.ai/docs/proxy/provider_budget_routing

  Use this endpoint to check current budget, spend and budget reset time for a provider

  Example Request

  ```bash
  curl -X GET http://localhost:4000/provider/budgets     -H "Content-Type: application/json"     -H "Authorization: Bearer sk-1234"
  ```

  Example Response

  ```json
  {
      "providers": {
          "openai": {
              "budget_limit": 1e-12,
              "time_period": "1d",
              "spend": 0.0,
              "budget_reset_at": null
          },
          "azure": {
              "budget_limit": 100.0,
              "time_period": "1d",
              "spend": 0.0,
              "budget_reset_at": null
          },
          "anthropic": {
              "budget_limit": 100.0,
              "time_period": "10d",
              "spend": 0.0,
              "budget_reset_at": null
          },
          "vertex_ai": {
              "budget_limit": 100.0,
              "time_period": "12d",
              "spend": 0.0,
              "budget_reset_at": null
          }
      }
  }
  ```

      Args:


      Returns:
          Any: The JSON response from the API call.

      Raises:
          Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /provider/budgets")

  params = {}
  data = {}

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/provider/budgets", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return response
  return response
